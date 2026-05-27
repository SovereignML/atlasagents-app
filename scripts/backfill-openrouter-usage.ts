// One-off backfill for margin-protected, real-usage OpenRouter billing.
// Run AFTER `npm run db:push` adds the new columns, and BEFORE enabling the
// usage-sync cron — otherwise the first poll computes delta = usage - 0 and
// double-charges all historical spend.
//
// Two steps, in order (step 2 depends on step 1):
//   1. wallets.lifetimeFundedCredits = GREATEST(sum of positive ledger
//      entries, current balance). Only fills rows still at the 0 default, so
//      it's safe to re-run.
//   2. For every non-deleted, managed-credit instance that owns a minted key:
//        - seed instances.openRouterUsageUsd from the key's CURRENT cumulative
//          OpenRouter usage (only where still 0 — re-run safe), and
//        - apply the cap: PATCH the key's limit to funded × margin and store
//          instances.openRouterLimitUsd. This also caps legacy keys that were
//          minted before per-key limits existed.
//
// Usage:
//   node --env-file=.env --import tsx scripts/backfill-openrouter-usage.ts
//
// Requires OPENROUTER_PROVISIONING_KEY for step 2 (step 1 still runs without).

import { db, wallets, instances, eq, and, isNotNull, sql } from "@/db"
import { getRuntimeKey, updateRuntimeKey } from "@/lib/openrouter-provisioning"
import { computeKeyLimitUsd } from "@/lib/openrouter-billing"

async function main() {
  // ── Step 1: lifetimeFundedCredits ──────────────────────────────────────
  const funded = await db.execute(sql`
    UPDATE "Wallet" w
    SET "lifetimeFundedCredits" = GREATEST(
      COALESCE((
        SELECT SUM(t.amount) FROM "WalletTransaction" t
        WHERE t."walletId" = w.id AND t.amount > 0
      ), 0),
      w.balance
    )
    WHERE w."lifetimeFundedCredits" = 0
  `)
  console.log(`[backfill] lifetimeFundedCredits set on ${funded.rowCount ?? 0} wallet(s)`)

  // ── Step 2: per-key usage pointer + cap ─────────────────────────────────
  if (!process.env.OPENROUTER_PROVISIONING_KEY) {
    console.warn(
      "[backfill] OPENROUTER_PROVISIONING_KEY not set — skipping usage/cap step. " +
        "Re-run with it set before enabling the usage-sync cron.",
    )
    return
  }

  const rows = await db.query.instances.findMany({
    where: and(
      isNotNull(instances.openRouterKeyId),
      sql`${instances.status} != 'deleted'`,
    ),
    columns: {
      id: true,
      userId: true,
      openRouterKeyId: true,
      byosLlmMode: true,
      openRouterUsageUsd: true,
    },
  })

  let seeded = 0
  let capped = 0
  const errors: string[] = []

  for (const row of rows) {
    if (row.byosLlmMode === "own_key" || !row.openRouterKeyId) continue
    try {
      const state = await getRuntimeKey(row.openRouterKeyId)

      // Seed the usage pointer only if it's still at the default — never
      // rewind a pointer the live poller has already advanced.
      if ((row.openRouterUsageUsd ?? 0) === 0 && state.usageUsd > 0) {
        await db
          .update(instances)
          .set({ openRouterUsageUsd: state.usageUsd })
          .where(eq(instances.id, row.id))
        seeded++
      }

      // Apply the cap (funded × margin) — idempotent, safe to re-run.
      const limitUsd = await computeKeyLimitUsd(row.userId)
      await updateRuntimeKey(row.openRouterKeyId, { limit: limitUsd })
      await db
        .update(instances)
        .set({ openRouterLimitUsd: limitUsd })
        .where(eq(instances.id, row.id))
      capped++
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(
    `[backfill] usage pointers seeded: ${seeded}; caps applied: ${capped}; errors: ${errors.length}`,
  )
  if (errors.length) {
    console.error("[backfill] errors:\n  " + errors.join("\n  "))
    process.exit(1)
  }
  console.log("[backfill] OK")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
