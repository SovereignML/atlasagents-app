import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, notifications, eq, and, desc, lt, isNull, isNotNull, sql } from "@/db"

/**
 * GET /api/notifications
 *
 * Current user's notification feed, newest first, plus the unread count.
 * Query params: ?limit=30  ?before=<ISO createdAt cursor>
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 100)
  const beforeRaw = url.searchParams.get("before")
  const before = beforeRaw ? new Date(beforeRaw) : null

  const where = before
    ? and(eq(notifications.userId, userId), lt(notifications.createdAt, before))
    : eq(notifications.userId, userId)

  const [rows, unread] = await Promise.all([
    db.query.notifications.findMany({
      where,
      orderBy: desc(notifications.createdAt),
      limit,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ])

  return NextResponse.json({
    notifications: rows,
    unreadCount: unread[0]?.count ?? 0,
  })
}

/**
 * PATCH /api/notifications
 *
 * Mark notifications read. Body: { id: string } for one, or { all: true }.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let body: { id?: string; all?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (body.all) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    return NextResponse.json({ ok: true })
  }

  if (body.id) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, body.id), eq(notifications.userId, userId)))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "id or all is required" }, { status: 400 })
}

/**
 * DELETE /api/notifications
 *
 * Permanently delete the current user's read notifications. Unread are kept.
 */
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  await db
    .delete(notifications)
    .where(and(eq(notifications.userId, session.user.id), isNotNull(notifications.readAt)))
  return NextResponse.json({ ok: true })
}
