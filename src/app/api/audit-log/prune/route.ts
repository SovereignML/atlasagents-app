import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, auditLogs, lt } from "@/db"
import { isValidCronBearer } from "@/lib/cron-auth"
import { AUDIT_RETENTION_DAYS } from "@/lib/audit"

/**
 * POST /api/audit-log/prune
 *
 * Deletes audit-log rows older than AUDIT_RETENTION_DAYS. Two ways to
 * authorize (mirrors /api/billing/daily):
 *   1. An admin-role user session (manual trigger from the admin panel).
 *   2. A bearer token matching AUDIT_RETENTION_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.AUDIT_RETENTION_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000)
  const result = await db.delete(auditLogs).where(lt(auditLogs.createdAt, cutoff))

  return NextResponse.json({
    deleted: result.rowCount ?? 0,
    cutoff: cutoff.toISOString(),
  })
}
