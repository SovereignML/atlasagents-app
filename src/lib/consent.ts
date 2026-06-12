// Cookie-consent state (GDPR / ePrivacy).
//
// Sending hashed email + click IDs to Meta/Google is "marketing" processing of
// personal data and requires the user's consent. This module models that
// decision; the ad-conversion layer (src/lib/ads) refuses to transmit anything
// unless `marketing` consent is granted, and the same decision is persisted
// onto the User row so the Stripe purchase webhook — which never sees the
// browser cookie — can honor it too.
//
// The cookie is intentionally NOT httpOnly: the consent banner
// (src/components/consent-banner.tsx) reads it client-side to decide whether to
// show. It carries only boolean preference flags, never PII.

export const CONSENT_COOKIE = "sov_consent"

/** One year — re-prompt annually, the common compliance cadence. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export type ConsentState = {
  /** Ad-conversion + retargeting (Meta/Google). Gates src/lib/ads. */
  marketing: boolean
  /** Product analytics (PostHog). Reserved — not yet wired to PostHog. */
  analytics: boolean
  /** Epoch ms the decision was recorded. */
  ts: number
}

export function parseConsentCookie(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>
  if (typeof o.marketing !== "boolean") return null
  return {
    marketing: o.marketing,
    analytics: typeof o.analytics === "boolean" ? o.analytics : false,
    ts: typeof o.ts === "number" && Number.isFinite(o.ts) ? o.ts : 0,
  }
}

export function serializeConsentCookie(state: {
  marketing: boolean
  analytics: boolean
  ts: number
}): string {
  return JSON.stringify({
    marketing: state.marketing,
    analytics: state.analytics,
    ts: state.ts,
  })
}

/** True only when the user has affirmatively granted marketing consent. */
export function hasMarketingConsent(raw: string | null | undefined): boolean {
  return parseConsentCookie(raw)?.marketing === true
}
