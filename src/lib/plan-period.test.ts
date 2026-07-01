import { describe, it, expect } from "vitest"
import { planPeriodEnd, creditGrantSchedule } from "./plan-period"

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

describe("creditGrantSchedule", () => {
  const from = new Date("2026-01-15T00:00:00Z")

  it("monthly: expires at the Stripe period end, no drip", () => {
    const periodEnd = new Date("2026-02-14T00:00:00Z")
    const s = creditGrantSchedule("month", periodEnd, from)
    expect(s.expireAt).toEqual(periodEnd)
    expect(s.nextCreditGrantAt).toBeNull()
  })

  it("monthly with no Stripe period: falls back to +1 month, no drip", () => {
    const s = creditGrantSchedule("month", null, from)
    expect(s.expireAt.toISOString()).toBe("2026-02-15T00:00:00.000Z")
    expect(s.nextCreditGrantAt).toBeNull()
  })

  it("yearly: first month expires in a month and schedules the next drip a month out", () => {
    const annualEnd = new Date("2027-01-15T00:00:00Z")
    const s = creditGrantSchedule("year", annualEnd, from)
    // Ignores the annual period end — the allotment is dripped monthly.
    expect(s.expireAt.toISOString()).toBe("2026-02-15T00:00:00.000Z")
    expect(s.nextCreditGrantAt?.toISOString()).toBe("2026-02-15T00:00:00.000Z")
  })
})
