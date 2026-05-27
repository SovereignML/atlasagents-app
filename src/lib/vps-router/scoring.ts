// Pure scoring for the ProviderRouter. No DB / IO here so it's trivially
// testable: feed RawCandidate fixtures, assert ranking + breakdowns.

import type { NormalizedCategory, ProviderHealthStatus } from "@/lib/vm-provider"
import type { RoutingWeights } from "@/configs/routing"
import { SUCCESS_RATE_PRIOR } from "@/configs/routing"
import type { Candidate, ScoreBreakdown } from "./types"

export type CandidateHealth = {
  status: ProviderHealthStatus
  latencyMs: number | null
} | null

export type CandidateBudget = {
  monthlyCreditsUsd: number
  currentUsageUsd: number
  softLimitUsd: number | null
  burnRateUsdPerDay: number
  remainingUsd: number
} | null

/** Everything the scorer needs about one provider/plan/region combination. */
export type RawCandidate = {
  providerId: string
  providerSlug: string
  providerName: string
  priority: number
  providerPlanCode: string
  monthlyCostUsd: number
  category: NormalizedCategory
  providerRegionCode: string
  budget: CandidateBudget
  health: CandidateHealth
  /** 0..1 provisioning success rate (already prior-smoothed by the caller). */
  successRate: number
  pinned: boolean
}

const RUNWAY_TARGET_DAYS = 30
const NEUTRAL = 0.5

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function remainingCreditScore(c: RawCandidate): number {
  if (!c.budget) return NEUTRAL
  let ratio = c.budget.remainingUsd / Math.max(c.budget.monthlyCreditsUsd, 1)
  // Past the soft limit → halve the score (still routable until the hard limit).
  if (c.budget.softLimitUsd != null && c.budget.currentUsageUsd > c.budget.softLimitUsd) {
    ratio *= 0.5
  }
  return clamp01(ratio)
}

function burnRateScore(c: RawCandidate): number {
  if (!c.budget) return NEUTRAL
  if (c.budget.burnRateUsdPerDay <= 1e-6) return 1 // no burn → full runway
  const runwayDays = c.budget.remainingUsd / c.budget.burnRateUsdPerDay
  return clamp01(runwayDays / RUNWAY_TARGET_DAYS)
}

function healthScore(c: RawCandidate): number {
  if (!c.health) return 0.8 // no recent probe — optimistic prior
  let base: number
  switch (c.health.status) {
    case "up":
      base = 1
      break
    case "degraded":
      base = 0.5
      break
    default:
      base = 0 // "down" is hard-filtered upstream; defensive
  }
  if (c.health.latencyMs != null && c.health.latencyMs > 2000) base *= 0.85
  return clamp01(base)
}

function costEfficiencyScore(c: RawCandidate, minCost: number): number {
  if (c.monthlyCostUsd <= 0) return NEUTRAL
  return clamp01(minCost / c.monthlyCostUsd)
}

function regionAvailabilityScore(c: RawCandidate, maxPriority: number): number {
  const priorityNorm = maxPriority > 0 ? c.priority / maxPriority : 1
  return clamp01(0.6 + 0.4 * priorityNorm)
}

/**
 * Score and rank candidates. Returns Candidates sorted best-first: pinned
 * providers always lead (they survived hard filters), then by weighted total.
 */
export function scoreCandidates(
  raws: RawCandidate[],
  weights: RoutingWeights,
): Candidate[] {
  if (raws.length === 0) return []
  const minCost = Math.min(...raws.map((r) => (r.monthlyCostUsd > 0 ? r.monthlyCostUsd : Infinity)))
  const maxPriority = Math.max(0, ...raws.map((r) => r.priority))

  const scored = raws.map((c): Candidate => {
    const factors = {
      remainingCredit: remainingCreditScore(c),
      burnRate: burnRateScore(c),
      health: healthScore(c),
      successRate: clamp01(c.successRate),
      costEfficiency: costEfficiencyScore(c, minCost),
      regionAvailability: regionAvailabilityScore(c, maxPriority),
    }
    const total =
      weights.remainingCredit * factors.remainingCredit +
      weights.burnRate * factors.burnRate +
      weights.health * factors.health +
      weights.successRate * factors.successRate +
      weights.costEfficiency * factors.costEfficiency +
      weights.regionAvailability * factors.regionAvailability

    const breakdown: ScoreBreakdown = { ...factors, total }
    return {
      providerId: c.providerId,
      providerSlug: c.providerSlug,
      providerName: c.providerName,
      providerPlanCode: c.providerPlanCode,
      providerRegionCode: c.providerRegionCode,
      monthlyCostUsd: c.monthlyCostUsd,
      category: c.category,
      pinned: c.pinned,
      score: total,
      breakdown,
    }
  })

  scored.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.score - a.score
  })
  return scored
}

/** Smooth a raw successes/attempts ratio toward the prior for low-volume providers. */
export function smoothedSuccessRate(successes: number, attempts: number, k = 5): number {
  return (successes + SUCCESS_RATE_PRIOR * k) / (attempts + k)
}
