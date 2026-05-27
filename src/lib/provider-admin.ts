// Read model for the admin providers dashboard + GET /api/admin/providers.
// Joins the provider registry with budget, the latest health probe, and a
// trailing-window provisioning success rate.

import {
  db,
  providers,
  providerHealthLogs,
  routingLogs,
  desc,
  gt,
  asc,
} from "@/db"
import { SUCCESS_RATE_WINDOW_MS } from "@/configs/routing"
import { smoothedSuccessRate } from "@/lib/vps-router"
import type { ProviderHealthStatus } from "@/lib/vm-provider"

export type ProviderOverview = {
  id: string
  slug: string
  name: string
  enabled: boolean
  priority: number
  pinnedRegionId: string | null
  credentialEnvKey: string | null
  billing: {
    monthlyCreditsUsd: number
    currentUsageUsd: number
    remainingUsd: number
    softLimitUsd: number | null
    hardLimitUsd: number | null
    burnRateUsdPerDay: number
  } | null
  health: {
    status: ProviderHealthStatus
    latencyMs: number | null
    checkedAt: Date
  } | null
  successRate: number | null
  provisioningSamples: number
}

export async function getProvidersOverview(): Promise<ProviderOverview[]> {
  const cutoff = new Date(Date.now() - SUCCESS_RATE_WINDOW_MS)
  const [rows, billingRows, healthRows, logRows] = await Promise.all([
    db.query.providers.findMany({ orderBy: [desc(providers.priority), asc(providers.slug)] }),
    db.query.providerBilling.findMany(),
    db
      .select({
        providerId: providerHealthLogs.providerId,
        status: providerHealthLogs.status,
        latencyMs: providerHealthLogs.latencyMs,
        checkedAt: providerHealthLogs.checkedAt,
      })
      .from(providerHealthLogs)
      .orderBy(desc(providerHealthLogs.checkedAt)),
    db
      .select({ providerId: routingLogs.chosenProviderId, outcome: routingLogs.outcome })
      .from(routingLogs)
      .where(gt(routingLogs.createdAt, cutoff)),
  ])

  const billingByProvider = new Map(billingRows.map((b) => [b.providerId, b]))
  const latestHealth = new Map<string, (typeof healthRows)[number]>()
  for (const h of healthRows) if (!latestHealth.has(h.providerId)) latestHealth.set(h.providerId, h)

  const tally = new Map<string, { succ: number; total: number }>()
  for (const r of logRows) {
    if (!r.providerId || (r.outcome !== "succeeded" && r.outcome !== "failed")) continue
    const t = tally.get(r.providerId) ?? { succ: 0, total: 0 }
    t.total++
    if (r.outcome === "succeeded") t.succ++
    tally.set(r.providerId, t)
  }

  return rows.map((p) => {
    const b = billingByProvider.get(p.id)
    const h = latestHealth.get(p.id)
    const t = tally.get(p.id)
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      enabled: p.enabled,
      priority: p.priority,
      pinnedRegionId: p.pinnedRegionId,
      credentialEnvKey: p.credentialEnvKey,
      billing: b
        ? {
            monthlyCreditsUsd: b.monthlyCreditsUsd,
            currentUsageUsd: b.currentUsageUsd,
            remainingUsd: Math.max(0, b.monthlyCreditsUsd - b.currentUsageUsd),
            softLimitUsd: b.softLimitUsd,
            hardLimitUsd: b.hardLimitUsd,
            burnRateUsdPerDay: b.burnRateUsdPerDay,
          }
        : null,
      health: h
        ? { status: h.status as ProviderHealthStatus, latencyMs: h.latencyMs, checkedAt: h.checkedAt }
        : null,
      successRate: t ? smoothedSuccessRate(t.succ, t.total) : null,
      provisioningSamples: t?.total ?? 0,
    }
  })
}
