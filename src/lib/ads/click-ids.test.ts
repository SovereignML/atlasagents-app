import { describe, it, expect } from "vitest"
import {
  parseAdClickCookie,
  serializeAdClickCookie,
  buildFbc,
  clickIdsFromSearchParams,
} from "./click-ids"

describe("ads/click-ids", () => {
  it("round-trips through serialize/parse", () => {
    const ids = { fbclid: "abc", gclid: "xyz", ts: 1700000000000 }
    expect(parseAdClickCookie(serializeAdClickCookie(ids))).toEqual(ids)
  })

  it("parse returns null for empty/garbage and when no ids present", () => {
    expect(parseAdClickCookie(null)).toBeNull()
    expect(parseAdClickCookie("")).toBeNull()
    expect(parseAdClickCookie("not json")).toBeNull()
    expect(parseAdClickCookie(JSON.stringify({ ts: 1 }))).toBeNull()
  })

  it("parse keeps whichever ids are present", () => {
    expect(parseAdClickCookie(JSON.stringify({ fbclid: "a" }))).toEqual({
      fbclid: "a",
      gclid: undefined,
      ts: undefined,
    })
  })

  it("parse rejects over-long click ids", () => {
    const huge = "x".repeat(600)
    expect(parseAdClickCookie(JSON.stringify({ gclid: huge }))).toBeNull()
  })

  it("buildFbc formats fb.1.<ts>.<fbclid>", () => {
    expect(buildFbc("CLICK123", 1700000000000)).toBe("fb.1.1700000000000.CLICK123")
  })

  it("buildFbc returns undefined without a fbclid", () => {
    expect(buildFbc(null, 1)).toBeUndefined()
    expect(buildFbc("", 1)).toBeUndefined()
  })

  it("buildFbc falls back to current time when capture ms is missing", () => {
    const fbc = buildFbc("CLICK123", null)
    expect(fbc).toMatch(/^fb\.1\.\d+\.CLICK123$/)
  })

  it("clickIdsFromSearchParams extracts fbclid/gclid", () => {
    const ids = clickIdsFromSearchParams(new URLSearchParams("?fbclid=a&gclid=b&x=1"))
    expect(ids?.fbclid).toBe("a")
    expect(ids?.gclid).toBe("b")
    expect(typeof ids?.ts).toBe("number")
  })

  it("clickIdsFromSearchParams returns null when neither is present", () => {
    expect(clickIdsFromSearchParams(new URLSearchParams("?utm_source=x"))).toBeNull()
  })
})
