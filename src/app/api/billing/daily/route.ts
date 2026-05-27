import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { runDailyBilling } from "@/lib/daily-billing"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/billing/daily
 *
 * Runs the daily billing job. Two ways to authorize:
 *   1. An admin-role user session (manual trigger from admin panel).
 *   2. A bearer token matching BILLING_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.BILLING_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await runDailyBilling()
  return NextResponse.json(report)
}
