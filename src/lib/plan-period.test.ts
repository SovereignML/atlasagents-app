import { describe, it, expect } from "vitest"
import { planPeriodEnd } from "./plan-period"

describe("planPeriodEnd", () => {
  it("adds one month for a monthly interval", () => {
    const from = new Date("2026-01-15T00:00:00Z")
    expect(planPeriodEnd("month", from).toISOString()).toBe("2026-02-15T00:00:00.000Z")
  })

  it("adds one year for a yearly interval", () => {
    const from = new Date("2026-01-15T00:00:00Z")
    expect(planPeriodEnd("year", from).toISOString()).toBe("2027-01-15T00:00:00.000Z")
  })

  it("defaults unknown intervals to one month", () => {
    const from = new Date("2026-03-10T00:00:00Z")
    expect(planPeriodEnd("weekly", from).toISOString()).toBe("2026-04-10T00:00:00.000Z")
  })

  it("does not mutate the input date", () => {
    const from = new Date("2026-01-15T00:00:00Z")
    planPeriodEnd("month", from)
    expect(from.toISOString()).toBe("2026-01-15T00:00:00.000Z")
  })
})
