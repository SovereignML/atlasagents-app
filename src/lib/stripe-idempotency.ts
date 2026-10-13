import crypto from "node:crypto"

/**
 * Idempotency keys for Stripe writes, so a retried or doubled request can't
 * create a second customer, checkout session, connected account or
 * cancellation. Stripe keeps a key for 24 hours and answers a repeat with the
 * original result.
 *
 * A key must only be reused with identical parameters (Stripe rejects a
 * mismatch), so every value that shapes the request goes into `parts`.
 *
 * For actions a person may legitimately repeat (buying credits twice, opening
 * checkout again after cancelling it), pass `windowKey()` as a part: requests
 * in the same short window share a key, which absorbs double clicks and
 * retries without blocking a deliberate second purchase a minute later.
 */
export function stripeIdempotencyKey(
  operation: string,
  ...parts: Array<string | number | null | undefined>
): string {
  const digest = crypto
    .createHash("sha256")
    .update(parts.map((p) => String(p ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 40)
  return `${operation}:${digest}`
}

/** The current time window, as a key part. Default one minute. */
export function windowKey(windowMs = 60_000, now = Date.now()): string {
  return `w${Math.floor(now / windowMs)}`
}
