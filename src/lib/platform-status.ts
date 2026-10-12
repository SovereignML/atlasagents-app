// What the public /status page reports. Every state comes from a check the app
// makes when the page is requested; the page used to show hardcoded uptime
// figures and invented incidents. Pure, so it can be unit-tested; the queries
// live in src/app/status/page.tsx.

export type CheckState = "operational" | "degraded" | "outage" | "unknown"

/** The newest health probe for one enabled VPS provider, or null if it has none. */
export type ProviderProbe = { status: string; checkedAt: Date } | null

/**
 * The reconcile cron probes every enabled provider every 15 minutes (see
 * scripts/cron-tick.sh). A newest probe older than this means the probing
 * itself has stopped, and says nothing about the provider.
 */
export const PROBE_STALE_MS = 60 * 60 * 1000

/**
 * Whether new agents can be deployed: yes while at least one enabled provider
 * answered its last probe. A failed provision also logs a "degraded" probe
 * (provisioner failover), so this reflects real deploy failures as well.
 */
export function deploymentsState(probes: ProviderProbe[], now: Date): CheckState {
  const fresh = probes.filter(
    (p): p is NonNullable<ProviderProbe> =>
      p != null && now.getTime() - p.checkedAt.getTime() <= PROBE_STALE_MS,
  )
  if (fresh.length === 0) return "unknown"
  if (fresh.some((p) => p.status === "up")) return "operational"
  if (fresh.some((p) => p.status === "degraded")) return "degraded"
  return "outage"
}

const SEVERITY: Record<CheckState, number> = {
  operational: 0,
  unknown: 1,
  degraded: 2,
  outage: 3,
}

/** The page's headline state: the worst of its checks. */
export function overallState(states: CheckState[]): CheckState {
  return states.reduce<CheckState>(
    (worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst),
    "operational",
  )
}

export const HEADLINES: Record<CheckState, string> = {
  operational: "All systems operational",
  degraded: "Some systems are degraded",
  outage: "Some systems are down",
  unknown: "Some systems could not be checked",
}
