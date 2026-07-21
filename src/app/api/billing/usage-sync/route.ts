import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { runOpenRouterUsageSyncLocked } from "@/lib/openrouter-usage"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/billing/usage-sync
 *
 * Polls each managed-credit instance's OpenRouter key for real spend, charges
 * the wallet for the delta (marked up by the margin), and enforces caps. Run
 * frequently (~every 10 min); tighter cadence = less metering lag, though the
 * per-key OpenRouter cap bounds worst-case overspend regardless.
 *
 * Two ways to authorize (mirrors /api/billing/daily):
 *   1. An admin-role user session (manual trigger from admin panel).
 *   2. A bearer token matching USAGE_SYNC_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.USAGE_SYNC_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await runOpenRouterUsageSyncLocked()
  return NextResponse.json(report)
}
