import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { evaluateAlertRules } from "@/lib/alerts"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/internal/alerts-eval
 *
 * Evaluates every enabled AlertRule against current agent metrics (Kuma health
 * snapshot + per-instance spend + AgentEvent error rate), respects each rule's
 * cooldown, and fires matches through notify() under the "monitoring" category.
 * Run on a schedule (~every few minutes) alongside uptime-sync / usage-sync.
 *
 * Authorize either way (mirrors /api/internal/uptime-sync):
 *   1. An admin-role user session (manual trigger).
 *   2. A bearer token matching ALERTS_EVAL_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.ALERTS_EVAL_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await evaluateAlertRules()
  return NextResponse.json(report)
}
