import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, supportTickets } from "@/db"
import { supportReplySchema } from "@/lib/validations"
import { postConversationReply } from "@/lib/chatwoot"
import { logAuditEvent } from "@/lib/audit"

/**
 * Post a reply from the logged-in user into their ticket's Chatwoot
 * conversation (as the customer). Owner-scoped; requires the ticket to be
 * linked to a live-chat conversation.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
  if (!ticket || ticket.userId !== session.user.id) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  }
  if (!ticket.chatwootConversationId) {
    return NextResponse.json(
      { error: "This ticket isn't connected to live chat yet." },
      { status: 409 },
    )
  }

  const ok = await postConversationReply(ticket.chatwootConversationId, parsed.data.content)
  if (!ok) {
    return NextResponse.json({ error: "Failed to send reply" }, { status: 502 })
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "support.ticket.reply",
    targetType: "ticket",
    targetId: ticket.id,
    targetLabel: ticket.subject,
  })

  return NextResponse.json({ ok: true })
}
