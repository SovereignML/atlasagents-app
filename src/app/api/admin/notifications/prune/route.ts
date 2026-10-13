import { NextRequest, NextResponse } from "next/server"
import { db, adminNotifications, and, eq, lt } from "@/db"
import { requireAdminOrCron } from "@/lib/admin-guard"
import { ADMIN_NOTIFICATION_RETENTION_DAYS } from "@/lib/audit"

/**
 * POST /api/admin/notifications/prune
 *
 * Deletes *resolved* admin notifications older than
 * ADMIN_NOTIFICATION_RETENTION_DAYS. Unresolved ones are left untouched. Two
 * ways to authorize (mirrors /api/audit-log/prune):
 *   1. An admin-role user session (manual trigger from the admin panel).
 *   2. A bearer token matching ADMIN_NOTIFICATION_RETENTION_CRON_TOKEN (cron).
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, process.env.ADMIN_NOTIFICATION_RETENTION_CRON_TOKEN)
  if (!guard.ok) return guard.res

  const cutoff = new Date(Date.now() - ADMIN_NOTIFICATION_RETENTION_DAYS * 86_400_000)
  const result = await db
    .delete(adminNotifications)
    .where(and(eq(adminNotifications.resolved, true), lt(adminNotifications.createdAt, cutoff)))

  return NextResponse.json({
    deleted: result.rowCount ?? 0,
    cutoff: cutoff.toISOString(),
  })
}
