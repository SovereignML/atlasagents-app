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
import { logAuditEvent } from "@/lib/audit"

/**
 * Post a reply from the logged-in user into their ticket's Chatwoot
 * conversation (as the customer). Owner-scoped. If the ticket isn't linked to
 * a conversation yet (it fell back to email at creation) but Chatwoot is
 * configured, lazily open one so the customer can always reply.
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

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  })
  if (!ticket || ticket.userId !== userId) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  }

  let conversationId = ticket.chatwootConversationId

  // Resolve the same Chatwoot the conversation was (or will be) created against.
  const cfg = await resolveChatwootForTeam(ticket.chatwootTenantTeamId)

  // Lazily link the ticket to a Chatwoot conversation if it was emailed at
  // creation (Chatwoot was down/unconfigured then but is available now).
  if (!conversationId) {
    if (!chatwootConfigured(cfg)) {
      return NextResponse.json(
        { error: "This ticket isn't connected to live chat. Our team will reply by email." },
        { status: 409 },
      )
    }
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, email: true },
    })
    if (!user?.email) {
      return NextResponse.json({ error: "Account is missing an email" }, { status: 400 })
    }
    const created = await createSupportConversation(cfg, {
      userId,
      name: user.name || user.email,
      email: user.email,
      subject: ticket.subject,
      message: ticket.message,
      priority: ticket.priority,
    })
    if (created.status !== "created") {
      return NextResponse.json({ error: "Failed to start the conversation" }, { status: 502 })
    }
    conversationId = created.conversationId
    await db
      .update(supportTickets)
      .set({
        chatwootConversationId: created.conversationId,
        chatwootContactId: created.contactId,
      })
      .where(eq(supportTickets.id, ticket.id))
  }

  const ok = await postConversationReply(cfg, conversationId, parsed.data.content)
  if (!ok) {
    return NextResponse.json({ error: "Failed to send reply" }, { status: 502 })
  }

  await logAuditEvent({
    userId,
    action: "support.ticket.reply",
    targetType: "ticket",
    targetId: ticket.id,
    targetLabel: ticket.subject,
  })

  return NextResponse.json({ ok: true })
}
