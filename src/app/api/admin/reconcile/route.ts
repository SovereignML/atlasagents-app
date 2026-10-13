import { NextRequest, NextResponse } from "next/server"
import { runReconcilerLocked } from "@/lib/reconciler"
import { runProviderHealthChecks } from "@/lib/provider-health"
import { runProviderBillingSync } from "@/lib/provider-billing"
import { runBillingReconcile, alertBillingReconcile } from "@/lib/billing-reconcile"
import { requireAdminOrCron } from "@/lib/admin-guard"

// POST /api/admin/reconcile
//
// Runs the reconciliation worker. Two ways to authorize:
//   1. An admin-role user session (for manual runs from the admin panel).
//   2. A bearer token matching RECONCILE_CRON_TOKEN (for scheduled cron).
//
// Long-running — set your cron timeout to at least 120s (scripts/cron-tick.sh
// passes one per endpoint). Overlapping runs are serialized by an advisory
// lock and return `skipped: true` rather than double-deleting VMs.
export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, process.env.RECONCILE_CRON_TOKEN)
  if (!guard.ok) return guard.res

  // ?scope=fast runs only what bounds money or gates a provisioning decision;
  // the default "full" adds the expensive, not-time-critical housekeeping.
  // scripts/cron-tick.sh calls fast on a tight interval and full twice a day.
  const scope = new URL(req.url).searchParams.get("scope") === "fast" ? "fast" : "full"

  // The provider health probe and the budget/burn sync stay on BOTH paths, and
  // deliberately so: this endpoint is their only caller, and the VPS router
  // rejects a provider on `health.status === "down"` and on a reached hard
  // limit. Their freshness is exactly this endpoint's interval, so demoting
  // them to twice-daily would mean routing on up to 12-hour-old data.
  // Billing reconciliation (credit drift) is full-only — it is a nightly-grade
  // audit, not an input to any live decision.
  const [health, billing, creditDrift] = await Promise.allSettled([
    runProviderHealthChecks(),
    runProviderBillingSync(),
    scope === "full"
      ? runBillingReconcile().then(async (r) => {
          const alerts = await alertBillingReconcile(r)
          return { ...r, alertsCreated: alerts }
        })
      : Promise.resolve({ skipped: true as const }),
  ])

  const report = await runReconcilerLocked({ scope })
  return NextResponse.json({
    scope,
    ...report,
    providerHealth: health.status === "fulfilled" ? health.value : { error: String(health.reason) },
    providerBilling: billing.status === "fulfilled" ? billing.value : { error: String(billing.reason) },
    billingReconcile:
      creditDrift.status === "fulfilled" ? creditDrift.value : { error: String(creditDrift.reason) },
  })
}
