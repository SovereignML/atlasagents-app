// ProviderRouter — picks the best VPS provider for a deployment.
//
// Inputs: normalized region + server config (+ optional workload type).
// Output: a ranked candidate list (best-first, drives failover), the chosen
// provider, and every rejection with a reason. The decision is persisted to
// routing_logs by logRoutingDecision() — the provisioner stamps the final
// outcome after the failover loop so per-provider success rates stay accurate.
//
// Budget is internal (provider_billing); the router never calls a provider
// balance API. See the plan + src/lib/provider-billing.ts.

import {
  db,
  providerPlans,
  providerRegions,
  providerHealthLogs,
  routingLogs,
  serverConfigs,
  eq,
  and,
  gt,
  desc,
} from "@/db"
import type { NormalizedCategory, ProviderHealthStatus } from "@/lib/vm-provider"
import {
  weightsFor,
  HEALTH_RECENT_WINDOW_MS,
  SUCCESS_RATE_WINDOW_MS,
  SUCCESS_RATE_PRIOR,
} from "@/configs/routing"
import { getAllProviderBudgets } from "@/lib/provider-billing"
import { scoreCandidates, smoothedSuccessRate, type RawCandidate, type CandidateHealth } from "./scoring"
import type { Candidate, RoutingDecision, RoutingInput, RoutingOutcome, Rejection } from "./types"

export * from "./types"
export { scoreCandidates, smoothedSuccessRate } from "./scoring"
export type { RawCandidate } from "./scoring"

function normalizeCategory(category: string): NormalizedCategory | null {
  if (category === "Shared") return "SHARED_CPU"
  if (category === "Dedicated") return "DEDICATED_CPU"
  return null // BYOS sentinel / unknown
}

/** Most-recent health status per provider within the recent window. */
async function recentHealthByProvider(): Promise<Map<string, CandidateHealth>> {
  const cutoff = new Date(Date.now() - HEALTH_RECENT_WINDOW_MS)
  const rows = await db
    .select({
      providerId: providerHealthLogs.providerId,
      status: providerHealthLogs.status,
      latencyMs: providerHealthLogs.latencyMs,
      checkedAt: providerHealthLogs.checkedAt,
    })
    .from(providerHealthLogs)
    .where(gt(providerHealthLogs.checkedAt, cutoff))
    .orderBy(desc(providerHealthLogs.checkedAt))

  const out = new Map<string, CandidateHealth>()
  for (const r of rows) {
    if (out.has(r.providerId)) continue // first seen = most recent (ordered desc)
    out.set(r.providerId, {
      status: r.status as ProviderHealthStatus,
      latencyMs: r.latencyMs ?? null,
    })
  }
  return out
}

/** Prior-smoothed provisioning success rate per provider from routing_logs. */
async function successRateByProvider(): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - SUCCESS_RATE_WINDOW_MS)
  const rows = await db
    .select({
      providerId: routingLogs.chosenProviderId,
      outcome: routingLogs.outcome,
    })
    .from(routingLogs)
    .where(gt(routingLogs.createdAt, cutoff))

  const tally = new Map<string, { succ: number; total: number }>()
  for (const r of rows) {
    if (!r.providerId) continue
    if (r.outcome !== "succeeded" && r.outcome !== "failed") continue
    const t = tally.get(r.providerId) ?? { succ: 0, total: 0 }
    t.total++
    if (r.outcome === "succeeded") t.succ++
    tally.set(r.providerId, t)
  }

  const out = new Map<string, number>()
  for (const [pid, t] of tally) out.set(pid, smoothedSuccessRate(t.succ, t.total))
  return out
}

/**
 * Compute a routing decision. Pure read — does NOT write routing_logs (call
 * logRoutingDecision separately, typically after provisioning resolves).
 */
export async function routeDeployment(input: RoutingInput): Promise<RoutingDecision> {
  const workload = input.workloadType ?? "general"
  const weights = weightsFor(workload)
  const profile = (await import("@/configs/routing")).WORKLOAD_PROFILES[workload]
  const requiredCategory = profile?.requiredCategory

  const [serverConfig, planRows, regionRows, budgets, healthMap, successMap] =
    await Promise.all([
      db.query.serverConfigs.findFirst({ where: eq(serverConfigs.id, input.serverConfigId) }),
      db.query.providerPlans.findMany({
        where: and(
          eq(providerPlans.serverConfigId, input.serverConfigId),
          eq(providerPlans.enabled, true),
        ),
        with: { provider: true },
      }),
      db.query.providerRegions.findMany({
        where: eq(providerRegions.regionId, input.regionId),
      }),
      getAllProviderBudgets(),
      recentHealthByProvider(),
      successRateByProvider(),
    ])

  const category = serverConfig ? normalizeCategory(serverConfig.category) : null
  const regionByProvider = new Map(regionRows.map((r) => [r.providerId, r]))

  const raws: RawCandidate[] = []
  const rejected: Rejection[] = []

  for (const plan of planRows) {
    const provider = plan.provider
    const reject = (reason: string) =>
      rejected.push({ providerId: provider.id, providerSlug: provider.slug, reason })

    if (!provider.enabled) {
      reject("provider_disabled")
      continue
    }
    if (requiredCategory && category !== requiredCategory) {
      reject("category_mismatch")
      continue
    }
    const region = regionByProvider.get(provider.id)
    if (!region) {
      reject("region_unavailable")
      continue
    }
    if (!region.available) {
      reject("region_capacity")
      continue
    }
    const budget = budgets.get(provider.id) ?? null
    if (budget && budget.hardLimitUsd != null && budget.currentUsageUsd >= budget.hardLimitUsd) {
      reject("hard_limit_reached")
      continue
    }
    const health = healthMap.get(provider.id) ?? null
    if (health && health.status === "down") {
      reject("unhealthy")
      continue
    }

    raws.push({
      providerId: provider.id,
      providerSlug: provider.slug,
      providerName: provider.name,
      priority: provider.priority,
      providerPlanCode: plan.providerPlanCode,
      monthlyCostUsd: plan.monthlyCostUsd,
      category: category ?? "SHARED_CPU",
      providerRegionCode: region.providerRegionCode,
      budget: budget
        ? {
            monthlyCreditsUsd: budget.monthlyCreditsUsd,
            currentUsageUsd: budget.currentUsageUsd,
            softLimitUsd: budget.softLimitUsd,
            burnRateUsdPerDay: budget.burnRateUsdPerDay,
            remainingUsd: budget.remainingUsd,
          }
        : null,
      health,
      successRate: successMap.get(provider.id) ?? SUCCESS_RATE_PRIOR,
      pinned: provider.pinnedRegionId === input.regionId,
    })
  }

  const ranked = scoreCandidates(raws, weights)
  return { ranked, chosen: ranked[0] ?? null, rejected }
}

/**
 * Persist a routing decision. `chosen` overrides which candidate is recorded as
 * the winner (used on failover to attribute success to the provider that
 * actually worked). `outcome` is "pending" at decision time, then updated to
 * "succeeded"/"failed" — or pass it directly when the result is already known.
 */
export async function logRoutingDecision(
  input: RoutingInput,
  decision: RoutingDecision,
  opts: { outcome: RoutingOutcome; chosen?: Candidate | null },
): Promise<string> {
  const chosen = opts.chosen !== undefined ? opts.chosen : decision.chosen
  const [row] = await db
    .insert(routingLogs)
    .values({
      instanceId: input.instanceId ?? null,
      regionId: input.regionId,
      serverConfigId: input.serverConfigId,
      workloadType: input.workloadType ?? "general",
      chosenProviderId: chosen?.providerId ?? null,
      score: chosen?.score ?? null,
      breakdown: chosen?.breakdown ?? null,
      rejected: decision.rejected,
      outcome: opts.outcome,
    })
    .returning({ id: routingLogs.id })
  return row.id
}
