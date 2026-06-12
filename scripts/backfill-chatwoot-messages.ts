// One-off backfill: repair support tickets whose original message never made
// it into Chatwoot (the "empty conversation shell" bug fixed in
// src/lib/chatwoot.ts). Two orphan shapes are handled:
//
//   • Linked-but-empty — ticket has a chatwootConversationId but that Chatwoot
//     conversation has no message body. We post the stored ticket.message into
//     the existing conversation (no new conversation, no new orphan).
//
//   • Unlinked-but-pushable — ticket has no chatwootConversationId, isn't
//     resolved, and its team resolves to a usable Chatwoot config. The original
//     push failed, so we re-run the (now-fixed) createSupportConversation and
//     persist the returned ids. Any stale empty shell left in Chatwoot from the
//     failed attempt is NOT auto-deleted (risky); the printed count tells you
//     how many to clear manually in the Chatwoot UI.
//
// DRY-RUN BY DEFAULT — prints what it would do. Pass --apply to make changes.
//
// Usage:
//   node --env-file=.env --import tsx scripts/backfill-chatwoot-messages.ts
//   node --env-file=.env --import tsx scripts/backfill-chatwoot-messages.ts --apply

import { db, eq, and, ne, isNull, isNotNull, supportTickets, users } from "@/db"
import {
  chatwootConfigured,
  createSupportConversation,
  getConversationMessages,
  postConversationReply,
  resolveChatwootForTeam,
} from "@/lib/chatwoot"

const APPLY = process.argv.includes("--apply")

async function main() {
  console.log(`[backfill] mode: ${APPLY ? "APPLY" : "DRY-RUN (pass --apply to write)"}`)

  let linkedFixed = 0
  let linkedSkipped = 0
  let relinked = 0
  let pushFailed = 0
  let staleShells = 0

  // ── 1. Linked-but-empty: conversation exists but carries no message body ──
  const linked = await db.query.supportTickets.findMany({
    where: isNotNull(supportTickets.chatwootConversationId),
    columns: {
      id: true,
      subject: true,
      message: true,
      chatwootConversationId: true,
      chatwootTenantTeamId: true,
    },
  })
  console.log(`[backfill] ${linked.length} ticket(s) linked to a conversation — checking for empty ones`)

  for (const t of linked) {
    const cfg = await resolveChatwootForTeam(t.chatwootTenantTeamId)
    if (!chatwootConfigured(cfg)) {
      console.warn(`  ? ${t.id}: no usable Chatwoot config — skipped`)
      linkedSkipped++
      continue
    }
    const convId = t.chatwootConversationId as number
    const msgs = await getConversationMessages(cfg, convId)
    if (msgs.some((m) => m.content.trim().length > 0)) continue // already has a body

    const content = `**${t.subject}**\n\n${t.message}`
    if (!APPLY) {
      console.log(`  ~ ${t.id}: conversation #${convId} is empty → would post message`)
      linkedFixed++
      continue
    }
    const ok = await postConversationReply(cfg, convId, content)
    if (ok) {
      console.log(`  ✓ ${t.id}: posted message into conversation #${convId}`)
      linkedFixed++
    } else {
      console.error(`  ✗ ${t.id}: failed to post into conversation #${convId}`)
      pushFailed++
    }
  }

  // ── 2. Unlinked-but-pushable: never linked, not resolved, Chatwoot available ──
  const unlinked = await db.query.supportTickets.findMany({
    where: and(
      isNull(supportTickets.chatwootConversationId),
      ne(supportTickets.status, "resolved"),
    ),
    columns: {
      id: true,
      userId: true,
      subject: true,
      message: true,
      priority: true,
      chatwootTenantTeamId: true,
    },
  })
  console.log(`[backfill] ${unlinked.length} unlinked non-resolved ticket(s) — checking for re-push`)

  for (const t of unlinked) {
    const cfg = await resolveChatwootForTeam(t.chatwootTenantTeamId)
    if (!chatwootConfigured(cfg)) continue // legitimately email-only; leave as-is

    const user = await db.query.users.findFirst({
      where: eq(users.id, t.userId),
      columns: { name: true, email: true },
    })
    if (!user?.email) {
      console.warn(`  ? ${t.id}: user has no email — skipped`)
      continue
    }

    if (!APPLY) {
      console.log(`  ~ ${t.id}: would open a Chatwoot conversation (re-push)`)
      relinked++
      staleShells++
      continue
    }

    const created = await createSupportConversation(cfg, {
      userId: t.userId,
      name: user.name || user.email,
      email: user.email,
      subject: t.subject,
      message: t.message,
      priority: t.priority,
    })
    if (created.status === "created") {
      await db
        .update(supportTickets)
        .set({
          chatwootConversationId: created.conversationId,
          chatwootContactId: created.contactId,
        })
        .where(eq(supportTickets.id, t.id))
      console.log(`  ✓ ${t.id}: opened conversation #${created.conversationId}`)
      relinked++
      staleShells++ // a prior failed attempt may have left an empty shell behind
    } else {
      console.error(
        `  ✗ ${t.id}: re-push ${created.status}` +
          (created.status === "failed" ? `: ${created.error}` : ""),
      )
      pushFailed++
    }
  }

  console.log(
    `[backfill] done: ${linkedFixed} empty-conversation(s) seeded, ${relinked} ticket(s) re-linked, ` +
      `${linkedSkipped} skipped (no config), ${pushFailed} failed.`,
  )
  if (staleShells > 0) {
    console.log(
      `[backfill] NOTE: up to ${staleShells} stale empty conversation(s) from the original ` +
        `failed pushes may remain in Chatwoot — review and clear them manually in the inbox.`,
    )
  }
  process.exit(pushFailed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
