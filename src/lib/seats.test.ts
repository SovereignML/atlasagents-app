import { describe, it, expect } from "vitest"
import { seatsForTier } from "@/configs/plans"

describe("seatsForTier", () => {
  it("maps each tier to its configured seat count", () => {
    expect(seatsForTier("free")).toBe(1)
    expect(seatsForTier("lite")).toBe(2)
    expect(seatsForTier("builder")).toBe(5)
    expect(seatsForTier("operator")).toBe(10)
    expect(seatsForTier("scale")).toBe(25)
    expect(seatsForTier("byos")).toBe(5)
  })

  it("treats enterprise as unlimited", () => {
    expect(seatsForTier("enterprise")).toBe(Infinity)
    expect(Number.isFinite(seatsForTier("enterprise"))).toBe(false)
  })
})
