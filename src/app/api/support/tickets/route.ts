import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, desc, users, supportTickets } from "@/db"
import { supportTicketSchema } from "@/lib/validations"
import { createSupportConversation, resolveChatwootForTeam } from "@/lib/chatwoot"
import { getUserTeam } from "@/lib/team"
import { sendSupportTicketEmail } from "@/lib/email"
import { logAuditEvent } from "@/lib/audit"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await req.json().catch(() => null)
  const parsed = supportTicketSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { subject, message, category, priority } = parsed.data

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true },
  })
  if (!user?.email) {
    return NextResponse.json({ error: "Account is missing an email" }, { status: 400 })
  }
  const name = user.name || user.email

  // Route to the tenant's Chatwoot when the user belongs to a white-label
  // tenant, else the platform's. Store the resolving team so reply/status
  // routes later resolve the SAME Chatwoot.
  const teamId = (await getUserTeam(userId))?.teamId ?? null
  const cfg = await resolveChatwootForTeam(teamId)

  // 1. Persist the ticket locally first so it's never lost.
  const [ticket] = await db
    .insert(supportTickets)
    .values({ userId, subject, message, category, priority, chatwootTenantTeamId: teamId })
    .returning()

  // 2. Push into Chatwoot; fall back to email only if that fails/unconfigured.
  const result = await createSupportConversation(cfg, {
    userId,
    name,
    email: user.email,
    subject,
    message,
    priority,
  })

  let delivery: "chatwoot" | "email" | "stored" = "stored"
  let chatwootError: string | undefined
  if (result.status === "created") {
    delivery = "chatwoot"
    await db
      .update(supportTickets)
      .set({
        chatwootConversationId: result.conversationId,
        chatwootContactId: result.contactId,
      })
      .where(eq(supportTickets.id, ticket.id))
  } else {
    if (result.status === "failed") chatwootError = result.error
    const sent = await sendSupportTicketEmail({
      fromName: name,
      fromEmail: user.email,
      subject,
      message,
      category,
      priority,
    })
    if (sent.success) delivery = "email"
  }

  await logAuditEvent({
    userId,
    action: "support.ticket",
    targetType: "ticket",
    targetId: ticket.id,
    targetLabel: subject,
    meta: { category, priority, delivery, ...(chatwootError ? { chatwootError } : {}) },
  })

  return NextResponse.json(
    {
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
      delivery,
      // Surface why Chatwoot delivery failed in non-prod to aid debugging,
      // without leaking internals to end users in production.
      ...(chatwootError && process.env.NODE_ENV !== "production"
        ? { chatwootError }
        : {}),
    },
    { status: 201 },
  )
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tickets = await db.query.supportTickets.findMany({
    where: eq(supportTickets.userId, session.user.id),
    orderBy: desc(supportTickets.createdAt),
  })
  return NextResponse.json({ tickets })
}
