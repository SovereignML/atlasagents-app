import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, users, deletionRequests, eq, and, desc } from "@/db"
import { deletionRequestSchema } from "@/lib/validations"
import { createAdminNotification } from "@/lib/admin-notify"
import { logAuditEvent } from "@/lib/audit"
import { sendNotificationEmail } from "@/lib/email"
import { BRANDING } from "@/configs/branding"

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

/**
 * GET /api/auth/account/delete-request
 * Returns the current user's most recent deletion request (or null), so the
 * account page can reflect pending / denied state.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const request = await db.query.deletionRequests.findFirst({
    where: eq(deletionRequests.userId, session.user.id),
    orderBy: desc(deletionRequests.createdAt),
  })

  return NextResponse.json({ request: request ?? null })
}

/**
 * POST /api/auth/account/delete-request
 * Submit an account deletion request for admin review. Approval is notify-only
 * — an admin performs the actual deletion. Blocks duplicate pending requests.
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = deletionRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const userId = session.user.id

  // One open request at a time.
  const existing = await db.query.deletionRequests.findFirst({
    where: and(eq(deletionRequests.userId, userId), eq(deletionRequests.status, "pending")),
  })
  if (existing) {
    return NextResponse.json({ ok: true, status: "pending", request: existing })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, email: true },
  })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const reason = parsed.data.reason?.trim() || null

  const [created] = await db
    .insert(deletionRequests)
    .values({ userId, reason, status: "pending" })
    .returning()

  await createAdminNotification({
    type: "account_deletion_request",
    userId,
    message: `${user.email} requested account deletion`,
    meta: { requestId: created.id, reason },
  })

  await logAuditEvent({ userId, action: "account.deletion_request", meta: { requestId: created.id } })

  // Alert the SovereignML team out-of-band.
  await sendNotificationEmail({
    to: BRANDING.supportEmail,
    title: "Account deletion request",
    message: `${user.name || user.email} (${user.email}) has requested to delete their account.${
      reason ? `\n\nReason: ${reason}` : ""
    }`,
    url: `${appUrl}/admin/deletion-requests`,
  })

  return NextResponse.json({ ok: true, status: "pending", request: created })
}

/**
 * DELETE /api/auth/account/delete-request
 * Cancel the user's own pending deletion request.
 */
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const existing = await db.query.deletionRequests.findFirst({
    where: and(
      eq(deletionRequests.userId, session.user.id),
      eq(deletionRequests.status, "pending"),
    ),
  })
  if (!existing) {
    return NextResponse.json({ error: "No pending request" }, { status: 404 })
  }

  await db.delete(deletionRequests).where(eq(deletionRequests.id, existing.id))
  await logAuditEvent({
    userId: session.user.id,
    action: "account.deletion_request.cancel",
    meta: { requestId: existing.id },
  })

  return NextResponse.json({ ok: true })
}
