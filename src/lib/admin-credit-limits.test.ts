import { describe, it, expect } from "vitest"

import { adjustmentRefusal } from "./admin-credit-limits"

const limits = { perCall: 100_000, dailyGrants: 250_000, alertAt: 25_000 }

describe("adjustmentRefusal", () => {
  it("allows an ordinary grant or removal", () => {
    expect(adjustmentRefusal(5_000, 0, limits)).toBeNull()
    expect(adjustmentRefusal(-5_000, 240_000, limits)).toBeNull()
  })

  it("refuses more than the per-call limit in either direction", () => {
    expect(adjustmentRefusal(100_001, 0, limits)).toMatch(/at most 100,000/)
    expect(adjustmentRefusal(-100_001, 0, limits)).toMatch(/at most 100,000/)
  })

  it("refuses a grant that would pass the admin's 24-hour total", () => {
    expect(adjustmentRefusal(60_000, 200_000, limits)).toMatch(/50,000 left/)
    expect(adjustmentRefusal(50_000, 200_000, limits)).toBeNull()
  })
})
