import { afterEach, describe, it, expect, vi } from "vitest"

import { legacyTokenWebhookAllowed } from "./telegram-webhook"

describe("legacyTokenWebhookAllowed", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("serves a bot that never moved to the secure path", () => {
    expect(legacyTokenWebhookAllowed({ telegramWebhookId: null })).toBe(true)
  })

  it("never serves a bot that has moved, since its old URL may be in logs", () => {
    expect(legacyTokenWebhookAllowed({ telegramWebhookId: "abc123" })).toBe(false)
  })

  it("closes the path for everyone with TG_LEGACY_TOKEN_WEBHOOKS=off", () => {
    vi.stubEnv("TG_LEGACY_TOKEN_WEBHOOKS", "off")
    expect(legacyTokenWebhookAllowed({ telegramWebhookId: null })).toBe(false)
  })
})
