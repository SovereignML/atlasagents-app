import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, supportTickets } from "@/db"
import {
  chatwootConfigured,
  getConversation,
  getConversationMessages,
  resolveChatwootForTeam,
  type ChatMessage,
  type ConversationState,
} from "@/lib/chatwoot"

/**
 * Map a Chatwoot conversation's state to the status we show the customer:
 *   resolved → resolved
 *   pending  → pending  ("awaiting your reply")
 *   open/snoozed with an assignee → in_progress ("being handled")
 *   open with no assignee → open ("awaiting our team")
 */
function deriveStatus(state: ConversationState): string {
  if (state.status === "resolved") return "resolved"
  if (state.status === "pending") return "pending"
  return state.assigneeName ? "in_progress" : "open"
}

/**
 * Ticket detail for the in-app thread view: the locally-stored ticket plus,
 * when it's linked to a Chatwoot conversation, the live message thread and the
 * derived status / assignee. Always scoped to the owner — other users' tickets
 * 404 (never leak existence).
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

  let messages: ChatMessage[] = []
  let status = ticket.status
  let assigneeName: string | null = null

  // Resolve the same Chatwoot the conversation was created against.
  const cfg = await resolveChatwootForTeam(ticket.chatwootTenantTeamId)

  if (ticket.chatwootConversationId) {
    const [msgs, state] = await Promise.all([
      getConversationMessages(cfg, ticket.chatwootConversationId),
      getConversation(cfg, ticket.chatwootConversationId),
    ])
    messages = msgs
    if (state) {
      assigneeName = state.assigneeName
      status = deriveStatus(state)
      // Persist the synced status so the list page badges stay accurate.
      if (status !== ticket.status) {
        await db
          .update(supportTickets)
          .set({ status })
          .where(eq(supportTickets.id, ticket.id))
      }
    }
  }

  return NextResponse.json({
    ticket: { ...ticket, status },
    messages,
    liveChat: Boolean(ticket.chatwootConversationId),
    // The customer can reply if a conversation exists, or one can be opened
    // on first reply (Chatwoot configured). Otherwise it's email-only.
    canReply: Boolean(ticket.chatwootConversationId) || chatwootConfigured(cfg),
    status,
    assigneeName,
  })
}
