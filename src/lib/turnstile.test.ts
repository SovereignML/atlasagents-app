import { afterEach, describe, it, expect, vi } from "vitest"

import { verifyTurnstileToken } from "./turnstile"

describe("verifyTurnstileToken without keys", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function unconfigured(env: Record<string, string>) {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "")
    vi.stubEnv("TURNSTILE_SECRET_KEY", "")
    vi.stubEnv("TURNSTILE_DISABLED", "")
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  }

  it("rejects every token in production", async () => {
    unconfigured({ NODE_ENV: "production" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await verifyTurnstileToken("anything")).toBe(false)
  })

  it("skips the check in production only when explicitly disabled", async () => {
    unconfigured({ NODE_ENV: "production", TURNSTILE_DISABLED: "true" })
    expect(await verifyTurnstileToken(undefined)).toBe(true)
  })

  it("skips the check outside production so local forms work", async () => {
    unconfigured({ NODE_ENV: "development" })
    expect(await verifyTurnstileToken(undefined)).toBe(true)
  })
})
