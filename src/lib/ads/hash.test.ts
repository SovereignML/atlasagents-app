import { describe, it, expect } from "vitest"
import { sha256Hex, hashEmail } from "./hash"

describe("ads/hash", () => {
  it("sha256Hex matches a known vector", () => {
    // SHA-256("hello") — fixed, well-known digest.
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })

  it("sha256Hex trims and returns undefined for empty input", () => {
    expect(sha256Hex("  hello  ")).toBe(sha256Hex("hello"))
    expect(sha256Hex("")).toBeUndefined()
    expect(sha256Hex("   ")).toBeUndefined()
    expect(sha256Hex(null)).toBeUndefined()
    expect(sha256Hex(undefined)).toBeUndefined()
  })

  it("hashEmail normalizes case + whitespace before hashing", () => {
    const canonical = hashEmail("user@example.com")
    expect(hashEmail("  USER@Example.COM ")).toBe(canonical)
    expect(canonical).toMatch(/^[0-9a-f]{64}$/)
  })

  it("hashEmail is undefined for missing emails", () => {
    expect(hashEmail("")).toBeUndefined()
    expect(hashEmail(null)).toBeUndefined()
    expect(hashEmail(undefined)).toBeUndefined()
  })
})
