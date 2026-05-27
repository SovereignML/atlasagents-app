// Provider health sweep. Pings each enabled provider's healthCheck() and
// records a provider_health_logs row. The router reads the most-recent log per
// provider when scoring. Run from the reconcile cron (or the admin
// "run health check" button for a single provider).

import { db, providerHealthLogs } from "@/db"
import { getAllEnabledProviders } from "@/lib/providers"
import type { VpsProvider, ProviderHealth } from "@/lib/vm-provider"

export type ProviderHealthSweepReport = {
  checked: number
  up: number
  degraded: number
  down: number
}

async function recordHealth(providerId: string, health: ProviderHealth): Promise<void> {
  await db.insert(providerHealthLogs).values({
    providerId,
    status: health.status,
    latencyMs: health.latencyMs ?? null,
    detail: (health.detail ?? null) as Record<string, unknown> | null,
  })
}

/** Probe one provider and persist the result. Returns the health snapshot. */
export async function checkProviderHealth(
  providerId: string,
  provider: VpsProvider,
): Promise<ProviderHealth> {
  let health: ProviderHealth
  try {
    health = await provider.healthCheck()
  } catch (err) {
    health = {
      status: "down",
      latencyMs: null,
      detail: { error: err instanceof Error ? err.message : String(err) },
    }
  }
  await recordHealth(providerId, health)
  return health
}

export async function runProviderHealthChecks(): Promise<ProviderHealthSweepReport> {
  const enabled = await getAllEnabledProviders()
  const report: ProviderHealthSweepReport = { checked: 0, up: 0, degraded: 0, down: 0 }

  await Promise.all(
    enabled.map(async (p) => {
      const health = await checkProviderHealth(p.providerId, p.provider)
      report.checked++
      report[health.status]++
    }),
  )

  return report
}
