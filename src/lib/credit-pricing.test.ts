import { describe, it, expect } from "vitest"
import {
  CREDITS_PER_USD,
  OPENROUTER_MARGIN,
  usdToCredits,
  creditsToUsd,
  keyLimitUsdFromCredits,
  openRouterUsdToCredits,
} from "./credit-pricing"

describe("credit-pricing", () => {
  it("uses 1 credit = $0.01", () => {
    expect(CREDITS_PER_USD).toBe(100)
  })

  it("usdToCredits rounds to whole credits and floors at 0", () => {
    expect(usdToCredits(1)).toBe(100)
    expect(usdToCredits(0.005)).toBe(1) // 0.5 credits rounds up
    expect(usdToCredits(0)).toBe(0)
    expect(usdToCredits(-5)).toBe(0)
    expect(usdToCredits(NaN)).toBe(0)
  })

  it("creditsToUsd is the inverse of usdToCredits for whole dollars", () => {
    expect(creditsToUsd(100)).toBe(1)
    expect(creditsToUsd(usdToCredits(42))).toBe(42)
    expect(creditsToUsd(NaN)).toBe(0)
  })

  it("defaults the margin to 0.9 when OPENROUTER_MARGIN is unset", () => {
    // Tests run without OPENROUTER_MARGIN in env.
    expect(OPENROUTER_MARGIN).toBe(0.9)
  })

  it("keyLimitUsdFromCredits caps at funded USD × margin", () => {
    // 1000 credits = $10 funded; cap = $10 × 0.9 = $9.
    expect(keyLimitUsdFromCredits(1000)).toBeCloseTo(9, 10)
  })

  it("openRouterUsdToCredits marks real spend up by 1/margin", () => {
    // $0.90 real usage ÷ 0.9 = $1.00 → 100 credits charged.
    expect(openRouterUsdToCredits(0.9)).toBe(100)
    expect(openRouterUsdToCredits(0)).toBe(0)
    expect(openRouterUsdToCredits(-1)).toBe(0)
  })

  it("cap and charge are duals: funded credits always cover marked-up real usage", () => {
    const fundedCredits = 1000 // $10 funded
    const capUsd = keyLimitUsdFromCredits(fundedCredits) // $9 of real OpenRouter spend allowed
    // If the key spends the whole cap, the wallet charge equals what was funded.
    expect(openRouterUsdToCredits(capUsd)).toBe(fundedCredits)
  })
})
