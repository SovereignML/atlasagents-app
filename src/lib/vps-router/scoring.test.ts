import { describe, it, expect } from "vitest"
import { ROUTING_WEIGHTS } from "@/configs/routing"
import { scoreCandidates, smoothedSuccessRate, clamp01, type RawCandidate } from "./scoring"

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    providerId: "p1",
    providerSlug: "linode",
    providerName: "Linode",
    priority: 10,
    providerPlanCode: "g6-standard-1",
    monthlyCostUsd: 10,
    category: "shared-1gb" as RawCandidate["category"],
    providerRegionCode: "us-east",
    budget: {
      monthlyCreditsUsd: 100,
      currentUsageUsd: 10,
      softLimitUsd: 80,
      burnRateUsdPerDay: 1,
      remainingUsd: 90,
    },
    health: { status: "up", latencyMs: 100 },
    successRate: 0.95,
    pinned: false,
    ...overrides,
  }
}

describe("scoring", () => {
  it("clamp01 bounds to [0,1] and maps NaN to 0", () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(NaN)).toBe(0)
  })

  it("returns [] for no candidates", () => {
    expect(scoreCandidates([], ROUTING_WEIGHTS)).toEqual([])
  })

  it("ranks a healthy, cheaper, well-funded provider above a degraded, costly one", () => {
    const good = candidate({ providerId: "good" })
    const bad = candidate({
      providerId: "bad",
      monthlyCostUsd: 40,
      health: { status: "degraded", latencyMs: 2500 },
      successRate: 0.5,
      budget: {
        monthlyCreditsUsd: 100,
        currentUsageUsd: 95,
        softLimitUsd: 80,
        burnRateUsdPerDay: 10,
        remainingUsd: 5,
      },
    })
    const ranked = scoreCandidates([bad, good], ROUTING_WEIGHTS)
    expect(ranked[0].providerId).toBe("good")
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it("pinned providers always lead regardless of score", () => {
    const strong = candidate({ providerId: "strong" })
    const pinnedWeak = candidate({
      providerId: "pinned",
      pinned: true,
      health: { status: "degraded", latencyMs: 3000 },
      successRate: 0.4,
    })
    const ranked = scoreCandidates([strong, pinnedWeak], ROUTING_WEIGHTS)
    expect(ranked[0].providerId).toBe("pinned")
    expect(ranked[0].score).toBeLessThan(ranked[1].score)
  })

  it("ranks DigitalOcean first as the primary provider (higher priority + cheaper)", () => {
    const digitalocean = candidate({
      providerId: "do",
      providerSlug: "digitalocean",
      providerName: "DigitalOcean",
      priority: 100,
      providerPlanCode: "s-2vcpu-2gb",
      monthlyCostUsd: 18,
    })
    const akamai = candidate({
      providerId: "akamai",
      providerSlug: "linode",
      priority: 90,
      monthlyCostUsd: 24,
    })
    const ranked = scoreCandidates([akamai, digitalocean], ROUTING_WEIGHTS)
    expect(ranked[0].providerSlug).toBe("digitalocean")
  })

  it("scores stay within [0,1] and breakdown matches the weighted sum", () => {
    const [c] = scoreCandidates([candidate()], ROUTING_WEIGHTS)
    expect(c.score).toBeGreaterThanOrEqual(0)
    expect(c.score).toBeLessThanOrEqual(1)
    expect(c.breakdown.total).toBeCloseTo(c.score, 10)
  })
})

describe("smoothedSuccessRate", () => {
  it("pulls low-volume providers toward the prior", () => {
    // Zero attempts → exactly the prior (0.9).
    expect(smoothedSuccessRate(0, 0)).toBeCloseTo(0.9, 10)
  })

  it("approaches the observed rate as volume grows", () => {
    const lowVol = smoothedSuccessRate(0, 2)
    const highVol = smoothedSuccessRate(0, 200)
    // Both below the prior, but high-volume is much closer to the true 0.
    expect(highVol).toBeLessThan(lowVol)
    expect(highVol).toBeLessThan(0.05)
  })
})
