import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import {
  getBillingHealthSnapshot,
  runBillingReconcile,
  alertBillingReconcile,
} from "@/lib/billing-reconcile"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * GET /api/admin/billing/health
 *
 * Billing correctness snapshot for the admin dashboard / monitoring:
 *   - default: cheap (ledger integrity + wallet totals + open drift alerts),
 *     safe to poll.
 *   - `?full=1`: also runs the live OpenRouter usage-drift scan (polls keys)
 *     and raises admin notifications for anything serious. Slower — match your
 *     client timeout accordingly.
 *
 * Authorize with an admin session, or a bearer token matching
 * RECONCILE_CRON_TOKEN (same token the reconcile cron uses).
 */
export async function GET(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.RECONCILE_CRON_TOKEN)
  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const full = req.nextUrl.searchParams.get("full") === "1"
  if (full) {
    const report = await runBillingReconcile()
    const alertsCreated = await alertBillingReconcile(report)
    return NextResponse.json({ ...report, alertsCreated })
  }

  const snapshot = await getBillingHealthSnapshot()
  return NextResponse.json(snapshot)
}
