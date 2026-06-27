import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, users, supportTickets } from "@/db"
import { supportReplySchema } from "@/lib/validations"
import {
  chatwootConfigured,
  createSupportConversation,
  postConversationReply,
  resolveChatwootForTeam,
} from "@/lib/chatwoot"
import { sendSupportTicketEmail } from "@/lib/email"
import { logAuditEvent } from "@/lib/audit"

/**
 * Post a reply from the logged-in user into their ticket's Chatwoot
 * conversation (as the customer). Owner-scoped. If the ticket isn't linked to
 * a conversation yet (it fell back to email at creation) but Chatwoot is
 * configured, lazily open one so the customer can always reply.
 *
 * Delivery is resilient: if Chatwoot is unconfigured or any Chatwoot call
 * fails, the reply is delivered to support by EMAIL instead of being lost
 * (mirrors ticket creation). A reply only errors out if BOTH channels fail.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = supportReplySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const content = parsed.data.content

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  })
  if (!ticket || ticket.userId !== userId) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true },
  })
  if (!user?.email) {
    return NextResponse.json({ error: "Account is missing an email" }, { status: 400 })
  }
  const name = user.name || user.email

  // Email fallback so a reply is never silently lost when Chatwoot is down or
  // unconfigured. Threads the original subject so it lands in the same chain.
  async function deliverByEmail(): Promise<boolean> {
    const sent = await sendSupportTicketEmail({
      fromName: name,
      fromEmail: user!.email!,
      subject: `Re: ${ticket!.subject}`,
      message: content,
      category: ticket!.category,
      priority: ticket!.priority,
    })
    return sent.success
  }

  let conversationId = ticket.chatwootConversationId
  const cfg = await resolveChatwootForTeam(ticket.chatwootTenantTeamId)
  let delivery: "chatwoot" | "email" | null = null

  // Lazily link the ticket to a Chatwoot conversation if it was emailed at
  // creation (Chatwoot was down/unconfigured then but is available now).
  if (!conversationId && chatwootConfigured(cfg)) {
    const created = await createSupportConversation(cfg, {
      userId,
      name,
      email: user.email,
      subject: ticket.subject,
      message: ticket.message,
      priority: ticket.priority,
    })
    if (created.status === "created") {
      conversationId = created.conversationId
      await db
        .update(supportTickets)
        .set({
          chatwootConversationId: created.conversationId,
          chatwootContactId: created.contactId,
        })
        .where(eq(supportTickets.id, ticket.id))
    }
  }

  // Prefer live chat; fall back to email on any failure (or when unlinked).
  if (conversationId && (await postConversationReply(cfg, conversationId, content))) {
    delivery = "chatwoot"
  } else if (await deliverByEmail()) {
    delivery = "email"
  }

  if (!delivery) {
    return NextResponse.json({ error: "Failed to send reply" }, { status: 502 })
  }

  await logAuditEvent({
    userId,
    action: "support.ticket.reply",
    targetType: "ticket",
    targetId: ticket.id,
    targetLabel: ticket.subject,
    meta: { delivery },
  })

  return NextResponse.json({ ok: true, delivery })
}
