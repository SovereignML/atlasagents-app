import { describe, it, expect } from "vitest"
import { compare, errorRate } from "./alert-metrics"

describe("alert compare()", () => {
  it("gt: true only when value exceeds threshold", () => {
    expect(compare(150, "gt", 100)).toBe(true)
    expect(compare(100, "gt", 100)).toBe(false)
    expect(compare(50, "gt", 100)).toBe(false)
  })

  it("lt: true only when value is below threshold", () => {
    expect(compare(0.95, "lt", 0.99)).toBe(true)
    expect(compare(0.99, "lt", 0.99)).toBe(false)
    expect(compare(1, "lt", 0.99)).toBe(false)
  })
})

describe("errorRate()", () => {
  it("is null with no events, so an idle agent never fires", () => {
    expect(errorRate({ total: 0, failed: 0 })).toBeNull()
  })

  it("counts failures over all runs, tool calls and error events", () => {
    // 7 ok runs + 1 standalone error event: the seed data's 1-in-8 pattern.
    expect(errorRate({ total: 8, failed: 1 })).toBe(0.125)
    expect(compare(errorRate({ total: 8, failed: 1 })!, "gt", 0.1)).toBe(true)
  })

  it("never exceeds 1 when one failure is reported twice", () => {
    expect(errorRate({ total: 2, failed: 3 })).toBe(1)
  })
})
