import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { db, deletionRequests, adminNotifications, eq, and, desc, sql } from "@/db"
import { deletionDecisionSchema } from "@/lib/validations"
import { logAuditEvent } from "@/lib/audit"
import { sendNotificationEmail } from "@/lib/email"
import { BRANDING } from "@/configs/branding"

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

/**
 * GET /api/admin/deletion-requests?status=pending|approved|denied
 * Lists account deletion requests for admin review.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const status = new URL(req.url).searchParams.get("status") ?? "pending"

  const rows = await db.query.deletionRequests.findMany({
    where: ["pending", "approved", "denied"].includes(status)
      ? eq(deletionRequests.status, status)
      : undefined,
    with: { user: { columns: { id: true, name: true, email: true } } },
    orderBy: desc(deletionRequests.createdAt),
    limit: 200,
  })

  return NextResponse.json(rows)
}

/**
 * PATCH /api/admin/deletion-requests
 * Decide a deletion request. Body: { id, action: "approve" | "deny", note? }
 * Approval is notify-only — it records the decision and emails the user; an
 * admin then deletes the account from the Users page.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = deletionDecisionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const { id, action, note } = parsed.data

  const existing = await db.query.deletionRequests.findFirst({
    where: eq(deletionRequests.id, id),
    with: { user: { columns: { id: true, name: true, email: true } } },
  })
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (existing.status !== "pending") {
    return NextResponse.json({ error: "Request already decided" }, { status: 409 })
  }

  const status = action === "approve" ? "approved" : "denied"

  await db
    .update(deletionRequests)
    .set({
      status,
      decidedBy: guard.userId,
      decidedAt: new Date(),
      decisionNote: note?.trim() || null,
    })
    .where(eq(deletionRequests.id, id))

  // Resolve the paired admin notification, if any.
  await db
    .update(adminNotifications)
    .set({ resolved: true, resolvedAt: new Date(), resolvedBy: guard.userId })
    .where(
      and(
        eq(adminNotifications.type, "account_deletion_request"),
        eq(adminNotifications.resolved, false),
        sql`${adminNotifications.meta}->>'requestId' = ${id}`,
      ),
    )

  await logAuditEvent({
    userId: guard.userId,
    action: action === "approve" ? "admin.deletion_request.approve" : "admin.deletion_request.deny",
    targetType: "user",
    targetId: existing.userId,
    targetLabel: existing.user?.email,
    meta: { requestId: id, note: note ?? null },
  })

  if (existing.user?.email) {
    await sendNotificationEmail({
      to: existing.user.email,
      title:
        action === "approve"
          ? "Your account deletion request was approved"
          : "Your account deletion request was declined",
      message:
        action === "approve"
          ? `Your request to delete your ${BRANDING.name} account has been approved. Our team will process the deletion shortly.${
              note ? `\n\nNote from our team: ${note}` : ""
            }`
          : `Your request to delete your ${BRANDING.name} account was not approved.${
              note ? `\n\nReason: ${note}` : ""
            }`,
      url: `${appUrl}/dashboard/account`,
    })
  }

  return NextResponse.json({ ok: true, status })
}
