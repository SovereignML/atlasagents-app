import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { reapExpiredDemoInstances } from "@/lib/demo-reaper"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/internal/demo-reap
 *
 * Tears down Free-tier demo agents whose 30-minute trial has elapsed (rows with
 * `expiresAt` in the past). Reuses the normal deleteBot() teardown, so the VM,
 * OpenRouter key, DNS, and monitor are all cleaned up. Idempotent — safe to run
 * on a tight cadence (~every 1 min) so the demo timer feels precise.
 *
 * Two ways to authorize (mirrors /api/internal/uptime-sync):
 *   1. An admin-role user session (manual trigger from the admin panel).
 *   2. A bearer token matching DEMO_REAP_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.DEMO_REAP_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await reapExpiredDemoInstances()
  return NextResponse.json(report)
}
