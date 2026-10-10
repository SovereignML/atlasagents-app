// In-process sweeps that must run even when no external cron is wired.
//
// scripts/cron-tick.sh drives these too, but a production box without the
// crontab installed silently lost both: Free demos outlived their 30-minute
// trial until someone happened to load an instance page (the only other
// trigger), and a paid deploy whose webhook went missing stayed `pending`
// forever. Both jobs are idempotent, so running here AND from cron is safe.
// Started from src/instrumentation.ts under the same production-only gate as
// the warm-pool scheduler — the reaper destroys real VMs.

import { maybeReapDemoInstances } from "@/lib/demo-reaper"
import { sweepPendingPaidCheckouts } from "@/lib/checkout-recovery"

const SWEEP_INTERVAL_MS = 60_000

let started = false
let inFlight = false

async function runSweeps(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    await maybeReapDemoInstances()
    await sweepPendingPaidCheckouts().catch((err) => {
      console.error("[background-sweeps] checkout recovery sweep failed:", err)
    })
  } finally {
    inFlight = false
  }
}

export function startBackgroundSweeps(): void {
  if (started) return
  started = true

  const kick = setTimeout(() => void runSweeps(), 15_000)
  kick.unref?.()
  const tick = setInterval(() => void runSweeps(), SWEEP_INTERVAL_MS)
  tick.unref?.()
}
