import { describe, it, expect } from "vitest"
import { proratedRefundCredits, DAY_MS } from "./compute-proration"

describe("proratedRefundCredits", () => {
  it("refunds the full charge when deleted immediately (elapsed 0)", () => {
    expect(proratedRefundCredits(300, 0)).toBe(300)
  })

  it("refunds half for a mid-day delete", () => {
    expect(proratedRefundCredits(300, DAY_MS / 2)).toBe(150)
  })

  it("refunds a quarter at 18h elapsed", () => {
    expect(proratedRefundCredits(300, (DAY_MS * 3) / 4)).toBe(75)
  })

  it("refunds nothing once a full day (or more) has elapsed", () => {
    expect(proratedRefundCredits(300, DAY_MS)).toBe(0)
    expect(proratedRefundCredits(300, DAY_MS * 2)).toBe(0)
  })

  it("clamps negative elapsed (clock skew) to a full refund", () => {
    expect(proratedRefundCredits(300, -5000)).toBe(300)
  })

  it("returns 0 for a non-positive or invalid daily cost", () => {
    expect(proratedRefundCredits(0, 0)).toBe(0)
    expect(proratedRefundCredits(-100, 0)).toBe(0)
    expect(proratedRefundCredits(NaN, 0)).toBe(0)
  })

  it("rounds to whole credits", () => {
    // 101 credits, 2/3 of the day remaining → 101 × (2/3) = 67.33 → 67.
    expect(proratedRefundCredits(101, DAY_MS / 3)).toBe(67)
  })
})
