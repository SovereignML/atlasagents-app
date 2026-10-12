import { describe, it, expect } from "vitest"
import { deploymentsState, overallState, PROBE_STALE_MS } from "@/lib/platform-status"

const now = new Date("2026-10-13T12:00:00Z")
const ago = (ms: number) => new Date(now.getTime() - ms)

describe("deploymentsState", () => {
  it("is operational while any enabled provider is up", () => {
    expect(
      deploymentsState(
        [
          { status: "down", checkedAt: ago(60_000) },
          { status: "up", checkedAt: ago(60_000) },
        ],
        now,
      ),
    ).toBe("operational")
  })

  it("is degraded when no provider is up but one is degraded", () => {
    expect(
      deploymentsState(
        [
          { status: "down", checkedAt: ago(60_000) },
          { status: "degraded", checkedAt: ago(60_000) },
        ],
        now,
      ),
    ).toBe("degraded")
  })

  it("is an outage when every fresh probe is down", () => {
    expect(deploymentsState([{ status: "down", checkedAt: ago(60_000) }], now)).toBe("outage")
  })

  it("ignores probes older than the staleness window", () => {
    // A stale "up" must not vouch for today; with nothing fresh, say so.
    expect(deploymentsState([{ status: "up", checkedAt: ago(PROBE_STALE_MS + 1) }], now)).toBe(
      "unknown",
    )
  })

  it("is unknown with no providers or no probes at all", () => {
    expect(deploymentsState([], now)).toBe("unknown")
    expect(deploymentsState([null], now)).toBe("unknown")
  })
})

describe("overallState", () => {
  it("is operational only when every check is", () => {
    expect(overallState(["operational", "operational"])).toBe("operational")
  })

  it("never reports operational while a check is unknown", () => {
    expect(overallState(["operational", "unknown"])).toBe("unknown")
  })

  it("takes the worst state", () => {
    expect(overallState(["unknown", "degraded", "operational"])).toBe("degraded")
    expect(overallState(["degraded", "outage", "unknown"])).toBe("outage")
  })
})
