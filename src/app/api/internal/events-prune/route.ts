import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, agentEvents, lt } from "@/db"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/internal/events-prune
 *
 * Deletes AgentEvent rows older than the retention window. AgentEvent is the
 * high-volume agent runtime stream; without this it grows unbounded. Run on a
 * schedule (e.g. daily) alongside usage-sync / uptime-sync.
 *
 * Retention: EVENTS_RETENTION_DAYS (default 30).
 *
 * Authorize either way (mirrors /api/internal/uptime-sync):
 *   1. An admin-role user session (manual trigger).
 *   2. A bearer token matching EVENTS_RETENTION_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.EVENTS_RETENTION_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const days = Math.max(1, Number(process.env.EVENTS_RETENTION_DAYS) || 30)
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const result = await db.delete(agentEvents).where(lt(agentEvents.createdAt, cutoff))

  return NextResponse.json({
    ok: true,
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    deleted: result.rowCount ?? 0,
  })
}
