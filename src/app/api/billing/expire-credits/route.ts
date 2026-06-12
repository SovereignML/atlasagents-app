import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { runCreditExpiry } from "@/lib/credit-expiry"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/billing/expire-credits
 *
 * Sweeps use-it-or-lose-it plan credits whose period has ended (cancelled /
 * lapsed subscriptions that get no renewal deposit). Two ways to authorize:
 *   1. An admin-role user session (manual trigger from admin panel).
 *   2. A bearer token matching CREDIT_EXPIRY_CRON_TOKEN (scheduled cron).
 *
 * Schedule daily, alongside /api/billing/daily and /api/billing/usage-sync.
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.CREDIT_EXPIRY_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await runCreditExpiry()
  return NextResponse.json(report)
}
