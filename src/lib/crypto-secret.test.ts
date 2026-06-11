import { describe, it, expect, beforeAll } from "vitest"
import crypto from "node:crypto"
import { encryptSecret, decryptSecret } from "./crypto-secret"

describe("crypto-secret", () => {
  beforeAll(() => {
    // 32-byte hex key for AES-256-GCM. Deterministic so the suite is stable.
    process.env.INSTANCE_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("round-trips a plaintext secret", () => {
    const secret = "super-secret-token-123"
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it("handles unicode and empty strings", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("")
    expect(decryptSecret(encryptSecret("naïve 🔐 café"))).toBe("naïve 🔐 café")
  })

  it("produces a fresh IV each call (ciphertext differs for same input)", () => {
    const a = encryptSecret("same")
    const b = encryptSecret("same")
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(decryptSecret(b))
  })

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow(/malformed/)
  })

  it("rejects a tampered auth tag", () => {
    const payload = encryptSecret("integrity")
    const [iv, ct] = payload.split(":")
    const forgedTag = crypto.randomBytes(16).toString("base64")
    expect(() => decryptSecret(`${iv}:${ct}:${forgedTag}`)).toThrow()
  })
})
