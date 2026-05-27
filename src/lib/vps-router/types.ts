import type { NormalizedCategory } from "@/lib/vm-provider"
import type { WorkloadType } from "@/configs/routing"

export type { WorkloadType }

export type RoutingInput = {
  regionId: string
  serverConfigId: string
  workloadType?: WorkloadType
  /** For logging only — links the routing_logs row to an instance when known. */
  instanceId?: string
}

export type ScoreBreakdown = {
  remainingCredit: number
  burnRate: number
  health: number
  successRate: number
  costEfficiency: number
  regionAvailability: number
  total: number
}

export type Candidate = {
  providerId: string
  providerSlug: string
  providerName: string
  providerPlanCode: string
  providerRegionCode: string
  monthlyCostUsd: number
  category: NormalizedCategory
  /** True when an admin pinned this provider for the requested region. */
  pinned: boolean
  score: number
  breakdown: ScoreBreakdown
}

export type Rejection = {
  providerId: string
  providerSlug: string
  reason: string
}

export type RoutingDecision = {
  /** Best-first. The provisioner walks this list for failover. */
  ranked: Candidate[]
  /** Convenience: ranked[0] ?? null. */
  chosen: Candidate | null
  rejected: Rejection[]
}

export type RoutingOutcome = "succeeded" | "failed" | "pending"
