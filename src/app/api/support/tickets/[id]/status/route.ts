import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, supportTickets } from "@/db"
import { supportStatusSchema } from "@/lib/validations"
import { setConversationStatus, resolveChatwootForTeam } from "@/lib/chatwoot"
import { logAuditEvent } from "@/lib/audit"

/**
 * Let the ticket owner mark their ticket resolved or reopen it. When the ticket
 * is linked to Chatwoot we toggle the conversation there too, so admins see the
 * customer's action. Owner-scoped; other users' tickets 404.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = supportStatusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { status } = parsed.data

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  })
  if (!ticket || ticket.userId !== session.user.id) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  }

  // Best-effort mirror to Chatwoot; never block the local update on it.
  if (ticket.chatwootConversationId) {
    const cfg = await resolveChatwootForTeam(ticket.chatwootTenantTeamId)
    await setConversationStatus(cfg, ticket.chatwootConversationId, status)
  }

  await db
    .update(supportTickets)
    .set({ status })
    .where(eq(supportTickets.id, ticket.id))

  await logAuditEvent({
    userId: session.user.id,
    action: "support.ticket.status",
    targetType: "ticket",
    targetId: ticket.id,
    targetLabel: ticket.subject,
    meta: { status },
  })

  return NextResponse.json({ status })
}
