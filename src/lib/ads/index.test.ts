import { describe, it, expect, vi, afterEach } from "vitest"
import { adsConversions } from "./index"

// With no META_*/GOOGLE_* env configured (the test environment), the facade must
// be a complete no-op: never throw, never hit the network. Call sites rely on
// this so they can call it unconditionally.
describe("adsConversions (unconfigured)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("reports disabled when no platform is configured", () => {
    expect(adsConversions.enabled).toBe(false)
  })

  it("trackSignup is a safe no-op and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    expect(() =>
      adsConversions.trackSignup({
        userId: "u1",
        email: "a@b.com",
        consent: true,
        clickIds: { fbclid: "f", gclid: "g" },
      }),
    ).not.toThrow()
    await Promise.resolve()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("trackPurchase is a safe no-op and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    expect(() =>
      adsConversions.trackPurchase({
        eventKey: "cs_1",
        email: "a@b.com",
        consent: true,
        value: 49,
        currency: "USD",
      }),
    ).not.toThrow()
    await Promise.resolve()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
