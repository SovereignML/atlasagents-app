import { describe, it, expect } from "vitest"

import { stripeIdempotencyKey, windowKey } from "./stripe-idempotency"

describe("stripeIdempotencyKey", () => {
  it("is stable for the same operation and parts", () => {
    expect(stripeIdempotencyKey("wallet-topup", "u1", 2000, "w1")).toBe(
      stripeIdempotencyKey("wallet-topup", "u1", 2000, "w1"),
    )
  })

  it("changes with any part, so different requests never share a key", () => {
    const base = stripeIdempotencyKey("wallet-topup", "u1", 2000, "w1")
    expect(stripeIdempotencyKey("wallet-topup", "u1", 5000, "w1")).not.toBe(base)
    expect(stripeIdempotencyKey("wallet-topup", "u2", 2000, "w1")).not.toBe(base)
    expect(stripeIdempotencyKey("byos-plan", "u1", 2000, "w1")).not.toBe(base)
  })

  it("does not let parts run together", () => {
    expect(stripeIdempotencyKey("op", "ab", "c")).not.toBe(stripeIdempotencyKey("op", "a", "bc"))
  })

  it("fits Stripe's 255-character limit", () => {
    expect(stripeIdempotencyKey("tenant-price", "x".repeat(1000)).length).toBeLessThan(255)
  })
})

describe("windowKey", () => {
  it("groups requests within the window and separates the next one", () => {
    expect(windowKey(60_000, 120_000)).toBe(windowKey(60_000, 179_999))
    expect(windowKey(60_000, 180_000)).not.toBe(windowKey(60_000, 179_999))
  })
})
