import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { db, adminNotifications, eq, desc } from "@/db"

/**
 * GET /api/admin/notifications
 *
 * Lists admin notifications. Optional query params:
 *   ?resolved=false  (default: only unresolved)
 *   ?limit=50
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const url = new URL(req.url)
  const showResolved = url.searchParams.get("resolved") === "true"
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200)

  const rows = await db.query.adminNotifications.findMany({
    where: showResolved
      ? undefined
      : eq(adminNotifications.resolved, false),
    with: { user: { columns: { id: true, name: true, email: true } } },
    orderBy: desc(adminNotifications.createdAt),
    limit,
  })

  return NextResponse.json(rows)
}

/**
 * PATCH /api/admin/notifications
 *
 * Mark a notification as resolved.
 * Body: { id: string }
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  let body: { id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const existing = await db.query.adminNotifications.findFirst({
    where: eq(adminNotifications.id, body.id),
  })
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await db
    .update(adminNotifications)
    .set({
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy: guard.userId,
    })
    .where(eq(adminNotifications.id, body.id))

  return NextResponse.json({ ok: true })
}
