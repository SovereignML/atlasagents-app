import { describe, it, expect } from "vitest"

import { scrubSentryEvent, scrubText } from "./sentry-scrub"

describe("scrubText", () => {
  it.each([
    ["Authorization: Bearer abcdef0123456789xyz", "Authorization: Bearer [redacted]"],
    ["stripe key sk_live_51Habcdefghijklmnop", "stripe key sk_live_[redacted]"],
    ["openrouter sk-or-v1-0123456789abcdef0123", "openrouter sk-[redacted]"],
    ["POST https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawq/setWebhook", "POST https://api.telegram.org/bot[telegram-token]/setWebhook"],
    ["user jane.doe+x@example.co.uk failed", "user [email] failed"],
    ["/reset?token=abc123&next=/x", "/reset?token=[redacted]&next=/x"],
    ["/tg/0123456789abcdef0123456789abcdef", "/tg/[hex]"],
  ])("scrubs %s", (input, expected) => {
    expect(scrubText(input)).toBe(expected)
  })

  it("leaves ordinary text alone", () => {
    expect(scrubText("Provision health check failed (exit 1)")).toBe(
      "Provision health check failed (exit 1)",
    )
  })
})

describe("scrubSentryEvent", () => {
  it("scrubs exception values, console arguments and breadcrumbs", () => {
    const event = scrubSentryEvent({
      exception: { values: [{ value: "login failed for a@b.io" }] },
      extra: { arguments: ["[deploy]", { email: "a@b.io", nested: ["Bearer abcdefghijklmnop"] }] },
      breadcrumbs: [{ message: "fetch https://x.test/?key=supersecret" }],
    })
    expect(event.exception?.values?.[0].value).toBe("login failed for [email]")
    expect(event.extra).toEqual({
      arguments: ["[deploy]", { email: "[email]", nested: ["Bearer [redacted]"] }],
    })
    expect(event.breadcrumbs?.[0].message).toBe("fetch https://x.test/?key=[redacted]")
  })
})
