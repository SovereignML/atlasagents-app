// Pure unit tests for the ProviderRouter scoring. No DB / env required:
//   npm run test:vps-router
//
// Covers: weighted ranking, soft-limit + cost-efficiency effects, the admin
// pin always leading, clamp bounds, and success-rate smoothing.

import { scoreCandidates, smoothedSuccessRate, clamp01, type RawCandidate } from "../src/lib/vps-router/scoring"
import { ROUTING_WEIGHTS } from "../src/configs/routing"

let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

function candidate(over: Partial<RawCandidate>): RawCandidate {
  return {
    providerId: over.providerSlug ?? "x",
    providerSlug: over.providerSlug ?? "x",
    providerName: over.providerSlug ?? "x",
    priority: 0,
    providerPlanCode: "plan",
    monthlyCostUsd: 24,
    category: "SHARED_CPU",
    providerRegionCode: "r",
    budget: { monthlyCreditsUsd: 1000, currentUsageUsd: 50, softLimitUsd: 800, burnRateUsdPerDay: 5, remainingUsd: 950 },
    health: { status: "up", latencyMs: 100 },
    successRate: 0.95,
    pinned: false,
    ...over,
  }
}

console.log("scoreCandidates — ranking")
{
  const linode = candidate({ providerSlug: "linode", successRate: 0.95 })
  const ovh = candidate({
    providerSlug: "ovh",
    monthlyCostUsd: 44, // pricier → cost-efficiency drag
    budget: { monthlyCreditsUsd: 2000, currentUsageUsd: 100, softLimitUsd: 1600, burnRateUsdPerDay: 5, remainingUsd: 1900 },
    successRate: 0.9,
  })
  const digitalocean = candidate({
    providerSlug: "digitalocean",
    health: { status: "degraded", latencyMs: 100 },
    budget: { monthlyCreditsUsd: 1000, currentUsageUsd: 850, softLimitUsd: 800, burnRateUsdPerDay: 20, remainingUsd: 150 }, // past soft, low runway
    successRate: 0.7,
  })

  const ranked = scoreCandidates([ovh, digitalocean, linode], ROUTING_WEIGHTS)
  assert(ranked[0].providerSlug === "linode", "healthiest + cheapest + most budget wins (linode)")
  assert(ranked[1].providerSlug === "ovh", "pricey-but-healthy ovh ranks above degraded do")
  assert(ranked[2].providerSlug === "digitalocean", "degraded + past-soft-limit do ranks last")
  assert(ranked[0].score > ranked[1].score && ranked[1].score > ranked[2].score, "scores strictly decreasing")
  assert(ranked.every((c) => c.breakdown.total === c.score), "breakdown.total mirrors score")
}

console.log("scoreCandidates — admin pin leads regardless of score")
{
  const good = candidate({ providerSlug: "linode" })
  const weakPinned = candidate({
    providerSlug: "ovh",
    monthlyCostUsd: 44,
    health: { status: "degraded", latencyMs: 3000 },
    successRate: 0.6,
    pinned: true,
  })
  const ranked = scoreCandidates([good, weakPinned], ROUTING_WEIGHTS)
  assert(ranked[0].providerSlug === "ovh", "pinned provider leads even with a lower raw score")
  assert(ranked[0].score < ranked[1].score, "pinned leader genuinely has the lower score")
}

console.log("clamp01")
{
  assert(clamp01(-1) === 0, "clamps below 0")
  assert(clamp01(2) === 1, "clamps above 1")
  assert(clamp01(0.5) === 0.5, "passes through in-range")
  assert(clamp01(NaN) === 0, "NaN → 0")
}

console.log("smoothedSuccessRate")
{
  assert(smoothedSuccessRate(0, 0) > 0.8 && smoothedSuccessRate(0, 0) < 0.95, "no data → near prior (0.9)")
  assert(smoothedSuccessRate(100, 100) > 0.95, "many successes → approaches 1")
  assert(smoothedSuccessRate(0, 100) < 0.1, "many failures → approaches 0")
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log("\nAll VPS router scoring tests passed.")
