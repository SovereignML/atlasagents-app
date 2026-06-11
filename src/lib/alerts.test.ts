import { describe, it, expect } from "vitest"
import { compare } from "./alert-metrics"

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
