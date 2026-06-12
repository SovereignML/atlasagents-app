// Public facade for server-side ad-conversion tracking (Meta + Google).
//
// Design mirrors src/lib/posthog-server.ts: fire-and-forget, never throws into
// the caller, and a complete no-op when nothing is configured — so call sites
// (signup route, Stripe webhook) stay a single unconditional line.
//
// Two hard gates before anything leaves the server:
//   1. Configuration — at least one platform has credentials.
//   2. Consent — the user granted "marketing" consent. We pass `consent`
//      explicitly because the Stripe webhook can't read the browser cookie; it
//      reads the persisted User.marketingConsent instead. See src/lib/consent.
//
// Match quality without a browser pixel comes from the click IDs captured on
// landing (src/lib/ads/click-ids) plus the hashed email. The purchase event in
// particular has NO IP/user-agent (it originates from Stripe's servers), so the
// stored click IDs are what make it attributable.

import { metaEnabled, sendMetaConversion } from "./meta"
import { googleEnabled, sendGoogleConversion } from "./google"

// Per-event Google Data Manager destinations (each maps to a Google Ads
// conversion action). Signup and purchase are distinct conversions.
const GOOGLE_SIGNUP_DESTINATION =
  process.env.GOOGLE_DM_SIGNUP_DESTINATION_ID?.trim() || undefined
const GOOGLE_PURCHASE_DESTINATION =
  process.env.GOOGLE_DM_PURCHASE_DESTINATION_ID?.trim() || undefined

type ClickIds = {
  fbclid?: string | null
  gclid?: string | null
  /** Epoch ms the click IDs were captured. */
  capturedAtMs?: number | null
}

type SignupArgs = {
  /** Stable dedup key; we use the user id. */
  userId: string
  email?: string | null
  clickIds?: ClickIds
  /** Whether marketing consent was granted (required to transmit). */
  consent: boolean
  /** Available on signup (real browser request); omit for webhooks. */
  clientIp?: string | null
  clientUserAgent?: string | null
  sourceUrl?: string | null
}

type PurchaseArgs = {
  /** Dedup key; we use the Stripe checkout session id. */
  eventKey: string
  email?: string | null
  clickIds?: ClickIds
  consent: boolean
  value: number
  currency: string
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Run both platform sends concurrently, isolating failures: one platform (or a
 * transient network error) must never break the caller or the other platform.
 */
async function dispatch(
  label: string,
  tasks: Array<{ platform: string; run: () => Promise<void> }>,
): Promise<void> {
  await Promise.all(
    tasks.map(async ({ platform, run }) => {
      try {
        await run()
      } catch (err) {
        console.error(`[ads] ${platform} ${label} failed:`, err)
      }
    }),
  )
}

export const adsConversions = {
  /** True when at least one ad platform is configured. */
  enabled: metaEnabled || googleEnabled,

  /**
   * Track an account registration. Meta "CompleteRegistration" + Google signup
   * conversion. Fire-and-forget — returns immediately.
   */
  trackSignup(args: SignupArgs): void {
    if (!this.enabled || !args.consent) return
    const eventTime = nowSeconds()
    const tasks: Array<{ platform: string; run: () => Promise<void> }> = []

    if (metaEnabled) {
      tasks.push({
        platform: "meta",
        run: () =>
          sendMetaConversion({
            eventName: "CompleteRegistration",
            eventId: `signup:${args.userId}`,
            eventTime,
            email: args.email,
            fbclid: args.clickIds?.fbclid,
            fbclidCapturedAtMs: args.clickIds?.capturedAtMs,
            clientIp: args.clientIp,
            clientUserAgent: args.clientUserAgent,
            sourceUrl: args.sourceUrl,
          }),
      })
    }
    if (googleEnabled && GOOGLE_SIGNUP_DESTINATION) {
      tasks.push({
        platform: "google",
        run: () =>
          sendGoogleConversion({
            destinationId: GOOGLE_SIGNUP_DESTINATION,
            transactionId: `signup:${args.userId}`,
            eventTime,
            email: args.email,
            gclid: args.clickIds?.gclid,
            clientIp: args.clientIp,
            clientUserAgent: args.clientUserAgent,
          }),
      })
    }

    void dispatch("signup", tasks)
  },

  /**
   * Track a purchase / subscription. Meta "Purchase" (with value+currency) +
   * Google purchase conversion. Called from the Stripe webhook, which has no
   * browser context — attribution rides on the stored click IDs + hashed email.
   */
  trackPurchase(args: PurchaseArgs): void {
    if (!this.enabled || !args.consent) return
    const eventTime = nowSeconds()
    const tasks: Array<{ platform: string; run: () => Promise<void> }> = []

    if (metaEnabled) {
      tasks.push({
        platform: "meta",
        run: () =>
          sendMetaConversion({
            eventName: "Purchase",
            eventId: `purchase:${args.eventKey}`,
            eventTime,
            email: args.email,
            fbclid: args.clickIds?.fbclid,
            fbclidCapturedAtMs: args.clickIds?.capturedAtMs,
            value: args.value,
            currency: args.currency,
          }),
      })
    }
    if (googleEnabled && GOOGLE_PURCHASE_DESTINATION) {
      tasks.push({
        platform: "google",
        run: () =>
          sendGoogleConversion({
            destinationId: GOOGLE_PURCHASE_DESTINATION,
            transactionId: `purchase:${args.eventKey}`,
            eventTime,
            email: args.email,
            gclid: args.clickIds?.gclid,
            value: args.value,
            currency: args.currency,
          }),
      })
    }

    void dispatch("purchase", tasks)
  },
}
