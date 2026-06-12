import { describe, it, expect } from "vitest"
import {
  parseConsentCookie,
  serializeConsentCookie,
  hasMarketingConsent,
} from "./consent"

describe("consent", () => {
  it("round-trips a decision", () => {
    const raw = serializeConsentCookie({ marketing: true, analytics: false, ts: 42 })
    expect(parseConsentCookie(raw)).toEqual({ marketing: true, analytics: false, ts: 42 })
  })

  it("requires a boolean marketing flag", () => {
    expect(parseConsentCookie(null)).toBeNull()
    expect(parseConsentCookie("garbage")).toBeNull()
    expect(parseConsentCookie(JSON.stringify({ analytics: true }))).toBeNull()
  })

  it("defaults analytics + ts when absent", () => {
    expect(parseConsentCookie(JSON.stringify({ marketing: true }))).toEqual({
      marketing: true,
      analytics: false,
      ts: 0,
    })
  })

  it("hasMarketingConsent is true only on an explicit grant", () => {
    expect(hasMarketingConsent(JSON.stringify({ marketing: true }))).toBe(true)
    expect(hasMarketingConsent(JSON.stringify({ marketing: false }))).toBe(false)
    expect(hasMarketingConsent(null)).toBe(false)
    expect(hasMarketingConsent("garbage")).toBe(false)
  })
})
