import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { collectServerMetrics } from "@/lib/server-metrics"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/internal/metrics-collect
 *
 * Probes every running VPS/BYOS instance over SSH and mirrors the latest
 * server hardware snapshot (CPU cores + load, RAM, disk, OS, uptime, health)
 * onto its hw* columns for the dashboard. Run frequently (~every 1–2 min) — the
 * probe is a single unprivileged SSH round-trip per instance, and failures mark
 * the box unreachable without wiping last-known specs.
 *
 * Two ways to authorize (mirrors /api/internal/uptime-sync):
 *   1. An admin-role user session (manual trigger from the admin panel).
 *   2. A bearer token matching METRICS_COLLECT_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.METRICS_COLLECT_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await collectServerMetrics()
  return NextResponse.json(report)
}
