// Fail-fast billing/payments config validation.
//
// Run once at server boot (see src/instrumentation.ts). In production a
// misconfiguration THROWS so the server refuses to serve traffic with broken
// payments — the alternative is silently 503-ing every paid endpoint at runtime
// (or, before the dev-bypass guards, granting infrastructure for free). In
// non-production we only collect warnings and never throw, so local dev keeps
// booting with blank Stripe keys.

import { isStripeConfigured } from "@/lib/stripe"

/** Cron tokens that protect the money/cron routes (see src/lib/cron-auth.ts). */
const CRON_TOKEN_VARS = [
  "BILLING_CRON_TOKEN",
  "RECONCILE_CRON_TOKEN",
  "USAGE_SYNC_CRON_TOKEN",
  "BACKUP_CRON_TOKEN",
] as const

/** Stripe price IDs read by src/configs/plans.ts. */
const PRICE_ID_VARS = [
  "STRIPE_PRICE_FREE_MONTHLY",
  "STRIPE_PRICE_FREE_YEARLY",
  "STRIPE_PRICE_BUILDER_MONTHLY",
  "STRIPE_PRICE_BUILDER_YEARLY",
  "STRIPE_PRICE_OPERATOR_MONTHLY",
  "STRIPE_PRICE_OPERATOR_YEARLY",
  "STRIPE_PRICE_SCALE_MONTHLY",
  "STRIPE_PRICE_SCALE_YEARLY",
  "STRIPE_PRICE_ENTERPRISE_MONTHLY",
  "STRIPE_PRICE_ENTERPRISE_YEARLY",
  "STRIPE_PRICE_BYOS_MONTHLY",
  "STRIPE_PRICE_BYOS_YEARLY",
] as const

type CheckResult = { errors: string[]; warnings: string[] }

function collect(): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ── Stripe secret key ──
  if (!isStripeConfigured()) {
    errors.push(
      "STRIPE_SECRET_KEY is missing, a placeholder, or not an sk_ key. Set a valid live key.",
    )
  } else if (!process.env.STRIPE_SECRET_KEY!.startsWith("sk_live_")) {
    warnings.push(
      "STRIPE_SECRET_KEY is a test key (sk_test_) — fine for a soft launch, but use sk_live_ for real payments.",
    )
  }

  // ── Webhook signing secret ──
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret || !webhookSecret.startsWith("whsec_")) {
    errors.push(
      "STRIPE_WEBHOOK_SECRET is missing or not a whsec_ secret. Top-ups and renewals will never credit without a verified webhook.",
    )
  }

  // ── Public app URL (used for Checkout success/cancel redirects) ──
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    errors.push("NEXT_PUBLIC_APP_URL is not set.")
  } else {
    let host = ""
    try {
      const u = new URL(appUrl)
      host = u.hostname
      if (u.protocol !== "https:") {
        errors.push(`NEXT_PUBLIC_APP_URL must be https in production (got ${u.protocol}).`)
      }
    } catch {
      errors.push(`NEXT_PUBLIC_APP_URL is not a valid URL: ${appUrl}`)
    }
    if (host === "localhost" || host === "127.0.0.1") {
      errors.push("NEXT_PUBLIC_APP_URL points at localhost — set it to your public domain.")
    }
  }

  // ── Cron tokens (unset ⇒ isValidCronBearer rejects ⇒ billing crons silently dead) ──
  for (const v of CRON_TOKEN_VARS) {
    if (!process.env[v]) {
      errors.push(`${v} is not set — the cron/money route it protects will reject every request.`)
    }
  }

  // ── Price IDs: warning only. Checkout currently builds inline price_data
  //    (see src/app/api/billing/wallet + deploy routes), so these are not
  //    required for payments to work — set them for Stripe reporting/tax and
  //    future migration to pre-created Prices.
  const missingPrices = PRICE_ID_VARS.filter((v) => !process.env[v])
  if (missingPrices.length > 0) {
    warnings.push(
      `${missingPrices.length} STRIPE_PRICE_* IDs unset (${missingPrices.join(", ")}). Optional today — Checkout uses inline pricing.`,
    )
  }

  return { errors, warnings }
}

/**
 * Validate billing config. In production, throws on any hard error (boot fails
 * loudly). In non-production, logs warnings and returns without throwing.
 */
export function assertBillingConfig(): void {
  const isProd = process.env.NODE_ENV === "production"
  const { errors, warnings } = collect()

  for (const w of warnings) {
    console.warn(`[billing-config] WARN: ${w}`)
  }

  if (!isProd) {
    // Dev/test: blank Stripe keys are expected (dev bypass handles payments).
    return
  }

  if (errors.length > 0) {
    const msg =
      "Billing is misconfigured for production. Fix these before serving traffic:\n" +
      errors.map((e) => `  • ${e}`).join("\n")
    throw new Error(msg)
  }
}
