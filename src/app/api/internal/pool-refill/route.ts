import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { refillWarmPoolLocked } from "@/lib/warm-pool"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * POST /api/internal/pool-refill
 *
 * Optional manual/admin backstop for the warm VM pool: advances in-flight VMs
 * (creating → bootstrapping → ready), reaps dead/stale ones, and creates the
 * deficit up to each target size. The pool now self-refills from an in-process
 * scheduler at server boot (see startWarmPoolScheduler), so this endpoint is no
 * longer required — it stays as a manual admin trigger / external-cron backstop.
 * Runs under the same advisory lock as the in-process tick, so a call during an
 * active tick returns { skipped: true } instead of racing it.
 *
 * Two ways to authorize (mirrors /api/internal/demo-reap):
 *   1. An admin-role user session (manual trigger from the admin panel).
 *   2. A bearer token matching POOL_REFILL_CRON_TOKEN (scheduled cron).
 */
export async function POST(req: NextRequest) {
  const isCron = isValidCronBearer(req, process.env.POOL_REFILL_CRON_TOKEN)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await refillWarmPoolLocked()
  return NextResponse.json(report)
}
