// Routing weights + workload profiles for the ProviderRouter. Tunable in one
// place — adjust scoring behaviour without touching src/lib/vps-router logic.

import type { NormalizedCategory } from "@/lib/vm-provider"

export type WorkloadType = "general" | "cpu_intensive" | "memory_intensive" | "burst"

/** Base weights for the six scoring factors. Should sum to 1.0. */
export type RoutingWeights = {
  remainingCredit: number
  burnRate: number
  health: number
  successRate: number
  costEfficiency: number
  regionAvailability: number
}

export const ROUTING_WEIGHTS: RoutingWeights = {
  remainingCredit: 0.25,
  burnRate: 0.15,
  health: 0.2,
  successRate: 0.15,
  costEfficiency: 0.15,
  regionAvailability: 0.1,
}

export type WorkloadProfile = {
  /** When set, candidates not in this category are hard-rejected. */
  requiredCategory?: NormalizedCategory
  /** Partial overrides merged over ROUTING_WEIGHTS for this workload. */
  weightOverrides?: Partial<RoutingWeights>
}

export const WORKLOAD_PROFILES: Record<WorkloadType, WorkloadProfile> = {
  general: {},
  // Latency/stability sensitive — force dedicated cores, value health + track record.
  cpu_intensive: {
    requiredCategory: "DEDICATED_CPU",
    weightOverrides: { health: 0.28, successRate: 0.22, costEfficiency: 0.08 },
  },
  // RAM-bound — health still matters, cost less so.
  memory_intensive: {
    weightOverrides: { health: 0.24, costEfficiency: 0.1, remainingCredit: 0.26 },
  },
  // Short-lived / price-sensitive — chase cheapest with budget headroom.
  burst: {
    weightOverrides: { costEfficiency: 0.3, remainingCredit: 0.2, health: 0.15 },
  },
}

/** Max providers to attempt in the failover loop before giving up. */
export const MAX_FAILOVER_ATTEMPTS = 3

/** Health logs older than this are ignored when scoring (ms). */
export const HEALTH_RECENT_WINDOW_MS = 30 * 60 * 1000 // 30 min

/** Trailing window for provisioning success-rate computation (ms). */
export const SUCCESS_RATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** New/low-volume providers get this assumed success rate until they have data. */
export const SUCCESS_RATE_PRIOR = 0.9

/** Resolve effective weights for a workload (base merged with overrides). */
export function weightsFor(workload: WorkloadType): RoutingWeights {
  const profile = WORKLOAD_PROFILES[workload] ?? {}
  return { ...ROUTING_WEIGHTS, ...(profile.weightOverrides ?? {}) }
}
