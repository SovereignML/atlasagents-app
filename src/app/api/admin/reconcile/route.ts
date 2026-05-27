import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { runReconciler } from "@/lib/reconciler"
import { runProviderHealthChecks } from "@/lib/provider-health"
import { runProviderBillingSync } from "@/lib/provider-billing"
import { runBillingReconcile, alertBillingReconcile } from "@/lib/billing-reconcile"
import { isValidCronBearer } from "@/lib/cron-auth"

// POST /api/admin/reconcile
//
// Runs the reconciliation worker. Two ways to authorize:
//   1. An admin-role user session (for manual runs from the admin panel).
//   2. A bearer token matching RECONCILE_CRON_TOKEN (for scheduled cron).
//
// Long-running — set your cron timeout to at least 60s.
export async function POST(req: NextRequest) {
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

  // Provider health probe + budget/burn-rate sync + billing reconciliation run
  // alongside the orphan/state reconciler so the router scores against fresh
  // data and credit drift gets caught. Best-effort — a failure in any of these
  // must not block the orphan/state reconciliation below.
  const [health, billing, creditDrift] = await Promise.allSettled([
    runProviderHealthChecks(),
    runProviderBillingSync(),
    runBillingReconcile().then(async (r) => {
      const alerts = await alertBillingReconcile(r)
      return { ...r, alertsCreated: alerts }
    }),
  ])

  const report = await runReconciler()
  return NextResponse.json({
    ...report,
    providerHealth: health.status === "fulfilled" ? health.value : { error: String(health.reason) },
    providerBilling: billing.status === "fulfilled" ? billing.value : { error: String(billing.reason) },
    billingReconcile:
      creditDrift.status === "fulfilled" ? creditDrift.value : { error: String(creditDrift.reason) },
  })
}
