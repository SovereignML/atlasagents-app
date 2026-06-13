import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { ensureUptimeMonitors, runUptimeSync } from "@/lib/uptime-monitoring"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/internal/uptime-sync
 *
 * Scrapes the operator's Uptime Kuma /metrics endpoint and writes the latest
 * status snapshot (status / response time / 24h uptime / cert expiry) onto each
 * instance that has a Kuma monitor. Kuma does the actual probing on its own
 * interval; this just mirrors the result into our DB for the dashboard. Run
 * frequently (~every 1–2 min) — tighter cadence = fresher badges, no extra load
 * on the monitored agents.
 *
 * Two ways to authorize (mirrors /api/billing/usage-sync):
 *   1. An admin-role user session (manual trigger from the admin panel).
 *   2. A bearer token matching UPTIME_SYNC_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.UPTIME_SYNC_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  // Backfill first so agents that predate the feature (or predate Kuma being
  // configured) get a monitor, then mirror the latest /metrics snapshot.
  const backfill = await ensureUptimeMonitors()
  const report = await runUptimeSync()
  return NextResponse.json({ ...report, backfill })
}
