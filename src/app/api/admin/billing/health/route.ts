import { NextRequest, NextResponse } from "next/server"
import {
  getBillingHealthSnapshot,
  runBillingReconcile,
  alertBillingReconcile,
} from "@/lib/billing-reconcile"
import { requireAdminOrCron } from "@/lib/admin-guard"

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
  const guard = await requireAdminOrCron(req, process.env.RECONCILE_CRON_TOKEN)
  if (!guard.ok) return guard.res

  const full = req.nextUrl.searchParams.get("full") === "1"
  if (full) {
    const report = await runBillingReconcile()
    const alertsCreated = await alertBillingReconcile(report)
    return NextResponse.json({ ...report, alertsCreated })
  }

  const snapshot = await getBillingHealthSnapshot()
  return NextResponse.json(snapshot)
}
