// Demo-agent reaper. Free-tier agents are time-boxed demos: they carry a
// non-null `expiresAt` (set at creation, re-stamped at go-live — see
// agent-create.ts / provisioner.ts). Once that deadline passes the agent is
// fully torn down (VM destroyed, OpenRouter key revoked, DNS/monitor removed,
// prorated credits refunded) by reusing the normal deleteBot() path.
//
// Driven two ways:
//   1. A durable cron — POST /api/internal/demo-reap (~every 1 min).
//   2. A throttled best-effort self-sweep from the dashboard pages, so a
//      watched demo reaps even with no external scheduler wired.

import { db, instances, instanceLogs, and, lt, isNotNull, notInArray } from "@/db"
import { deleteBot } from "@/lib/provisioner"

export type ReapReport = { reaped: number; errors: string[] }

/**
 * Find demo agents past their `expiresAt` deadline and tear them down.
 * Best-effort + idempotent: rows already in `deleting`/`deleted` are excluded,
 * so overlapping triggers don't double-act, and a per-instance failure is
 * collected rather than aborting the sweep.
 */
export async function reapExpiredDemoInstances(): Promise<ReapReport> {
  const report: ReapReport = { reaped: 0, errors: [] }

  const expired = await db.query.instances.findMany({
    where: and(
      isNotNull(instances.expiresAt),
      lt(instances.expiresAt, new Date()),
      notInArray(instances.status, ["deleting", "deleted"]),
    ),
  })

  for (const instance of expired) {
    try {
      await db.insert(instanceLogs).values({
        instanceId: instance.id,
        level: "info",
        message: "Demo expired — agent torn down after its 30-minute trial.",
      })
      await deleteBot(instance)
      report.reaped++
    } catch (err) {
      report.errors.push(`${instance.id}: ${(err as Error).message}`)
    }
  }

  return report
}

// ── Throttled self-sweep (dashboard-driven) ──────────────────────────────
// Mirrors the maybeRunUptimeSync throttle in uptime-monitoring.ts: a single
// in-flight sweep, rate-limited so frequent page loads don't pile up reaps.
let lastReapAt = 0
let reapInFlight: Promise<unknown> | null = null
const REAP_MIN_INTERVAL_MS = 60_000

/**
 * Fire-and-forget demo reap suitable for calling on dashboard page loads.
 * No-ops when one ran in the last REAP_MIN_INTERVAL_MS or is already running.
 * Never throws.
 */
export async function maybeReapDemoInstances(): Promise<void> {
  if (reapInFlight) {
    await reapInFlight.catch(() => {})
    return
  }
  if (Date.now() - lastReapAt < REAP_MIN_INTERVAL_MS) return
  lastReapAt = Date.now()
  reapInFlight = reapExpiredDemoInstances()
    .catch(() => {})
    .finally(() => {
      reapInFlight = null
    })
  await reapInFlight
}
