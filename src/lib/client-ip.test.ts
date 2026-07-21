import { describe, it, expect } from "vitest"
import { clientIp } from "./client-ip"

describe("clientIp", () => {
  it("prefers cf-connecting-ip even when x-forwarded-for is present", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.5",
      "x-forwarded-for": "attacker-value, 203.0.113.7",
    })
    expect(clientIp(headers)).toBe("198.51.100.5")
  })

  it("returns the rightmost x-forwarded-for hop, trimmed", () => {
    const headers = new Headers({
      "x-forwarded-for": "attacker-value, 203.0.113.7",
    })
    expect(clientIp(headers)).toBe("203.0.113.7")
  })

  it("returns the single x-forwarded-for entry when only one hop", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" })
    expect(clientIp(headers)).toBe("203.0.113.9")
  })

  it("returns 'unknown' when no relevant headers are set", () => {
    const headers = new Headers({ "user-agent": "test" })
    expect(clientIp(headers)).toBe("unknown")
  })

  it("returns 'unknown' when the headers object is undefined", () => {
    expect(clientIp(undefined)).toBe("unknown")
  })

  it("returns 'unknown' for empty / whitespace-only header values", () => {
    const cfEmpty = { get: (name: string) => (name === "cf-connecting-ip" ? "   " : null) }
    expect(clientIp(cfEmpty)).toBe("unknown")

    const xffEmpty = new Headers({ "x-forwarded-for": " , , " })
    expect(clientIp(xffEmpty)).toBe("unknown")
  })
})
