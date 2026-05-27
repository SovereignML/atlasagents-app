import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, supportTickets } from "@/db"
import { getConversationMessages } from "@/lib/chatwoot"

/**
 * Ticket detail for the in-app thread view: the locally-stored ticket plus,
 * when it's linked to a Chatwoot conversation, the live message thread.
 * Always scoped to the owner — other users' tickets 404 (never leak existence).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  })
  if (!ticket || ticket.userId !== session.user.id) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  }

  const messages = ticket.chatwootConversationId
    ? await getConversationMessages(ticket.chatwootConversationId)
    : []

  return NextResponse.json({
    ticket,
    messages,
    liveChat: Boolean(ticket.chatwootConversationId),
  })
}
