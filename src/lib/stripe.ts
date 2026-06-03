// Server-side Stripe client. Lazy-init so dev still boots without a real key.
// In dev mode, /api/checkout detects the placeholder and uses the dev mock flow.

import Stripe from "stripe"

const STRIPE_PLACEHOLDER = "sk_test_placeholder"

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY ?? STRIPE_PLACEHOLDER
  _stripe = new Stripe(key, {
    apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
    appInfo: { name: "SovereignML", version: "0.1.0" },
  })
  return _stripe
}

// Proxy so existing `import { stripe }` call sites keep working,
// but instantiation is deferred until first property access at runtime.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === "function" ? value.bind(client) : value
  },
}) as Stripe

export function isStripeConfigured(): boolean {
  return (
    !!process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_SECRET_KEY !== STRIPE_PLACEHOLDER &&
    process.env.STRIPE_SECRET_KEY.startsWith("sk_")
  )
}

/**
 * True only when it is safe to run the no-payment dev bypass: Stripe is NOT
 * configured AND we are not in production. In production this is ALWAYS false,
 * so the free-grant / free-deploy paths become unreachable. Payment endpoints
 * should return STRIPE_NOT_CONFIGURED (503) when this is false and Stripe is
 * unconfigured, rather than silently provisioning or granting credits for free.
 */
export function isDevBypassAllowed(): boolean {
  return !isStripeConfigured() && process.env.NODE_ENV !== "production"
}

/** Standard 503 body for "Stripe required but not configured in production". */
export const STRIPE_NOT_CONFIGURED = { error: "Payments are not configured" } as const
