import { describe, it, expect } from "vitest"
import { decideEnforcement, ANOMALY_USD_PER_INTERVAL } from "@/lib/usage-enforcement"

// A funded paid agent with headroom left under its cap.
const healthy = {
  usageUsd: 1,
  limitUsd: 5,
  deltaUsd: 0.2,
  aboveMinimum: true,
  demo: false,
}

describe("decideEnforcement", () => {
  it("leaves a funded agent with headroom running", () => {
    expect(decideEnforcement(healthy)).toBeNull()
  })

  it("pauses a paid agent whose wallet fell below the floor", () => {
    expect(decideEnforcement({ ...healthy, aboveMinimum: false })).toEqual({
      reason: "wallet balance below minimum",
      anomaly: false,
    })
  })

  it("does not pause a fresh Free demo for sitting below the wallet floor", () => {
    // The regression: 10 granted credits < the 200-credit floor, zero usage,
    // and the demo was paused on its first poll.
    const freshDemo = { usageUsd: 0, limitUsd: 0.09, deltaUsd: 0, aboveMinimum: false, demo: true }
    expect(decideEnforcement(freshDemo)).toBeNull()
  })

  it("still pauses a demo that reaches its key cap", () => {
    expect(
      decideEnforcement({ usageUsd: 0.09, limitUsd: 0.09, deltaUsd: 0.05, aboveMinimum: false, demo: true }),
    ).toEqual({ reason: "OpenRouter spend cap reached", anomaly: false })
  })

  it("still pauses a demo on anomalous spend", () => {
    const deltaUsd = ANOMALY_USD_PER_INTERVAL + 1
    expect(
      decideEnforcement({ usageUsd: deltaUsd, limitUsd: null, deltaUsd, aboveMinimum: true, demo: true }),
    ).toEqual({ reason: `anomalous spend $${deltaUsd.toFixed(2)} in one interval`, anomaly: true })
  })

  it("reports an anomaly ahead of a reached cap", () => {
    const deltaUsd = ANOMALY_USD_PER_INTERVAL + 1
    const result = decideEnforcement({ ...healthy, usageUsd: 100, limitUsd: 5, deltaUsd })
    expect(result?.anomaly).toBe(true)
  })

  it("never treats a key without a cap as cap-hit", () => {
    expect(decideEnforcement({ ...healthy, usageUsd: 1_000, limitUsd: null })).toBeNull()
  })
})
