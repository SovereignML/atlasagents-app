// Stripe Connect (Standard) for white-label reseller billing.
//
// A tenant connects their OWN Stripe account; their end-customers' subscriptions
// are created ON that connected account (direct charges) so the money is the
// tenant's. We take NO platform application fee — we only bill the tenant the
// enterprise/white-label fee on the platform's own Stripe (unchanged).
//
// Connected-account events arrive on a SEPARATE webhook endpoint
// (/api/webhooks/stripe-connect); see src/lib/stripe-connect-events.ts.

import Stripe from "stripe"
import { stripe } from "@/lib/stripe"
import { db, eq, tenantConfig } from "@/db"
import { getTenantConfig } from "@/lib/tenant"

/** Create (or reuse) the tenant's connected Standard account; persist its id. */
export async function createConnectAccount(tenantTeamId: string): Promise<string> {
  const existing = await getTenantConfig(tenantTeamId)
  if (existing?.stripeConnectAccountId) return existing.stripeConnectAccountId

  const account = await stripe.accounts.create({ type: "standard" })

  await db
    .insert(tenantConfig)
    .values({ teamId: tenantTeamId, stripeConnectAccountId: account.id })
    .onConflictDoUpdate({
      target: tenantConfig.teamId,
      set: { stripeConnectAccountId: account.id, updatedAt: new Date() },
    })

  return account.id
}

/** A Stripe-hosted onboarding link for the connected account. */
export async function createAccountOnboardingLink(
  accountId: string,
  opts: { refreshUrl: string; returnUrl: string },
): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: opts.refreshUrl,
    return_url: opts.returnUrl,
    type: "account_onboarding",
  })
  return link.url
}

/** Re-read the connected account and persist charges/payouts-enabled flags. */
export async function refreshConnectStatus(
  tenantTeamId: string,
): Promise<{ accountId: string | null; chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const cfg = await getTenantConfig(tenantTeamId)
  if (!cfg?.stripeConnectAccountId) {
    return { accountId: null, chargesEnabled: false, payoutsEnabled: false }
  }
  const account = await stripe.accounts.retrieve(cfg.stripeConnectAccountId)
  const chargesEnabled = Boolean(account.charges_enabled)
  const payoutsEnabled = Boolean(account.payouts_enabled)

  await db
    .update(tenantConfig)
    .set({
      stripeConnectChargesEnabled: chargesEnabled,
      stripeConnectPayoutsEnabled: payoutsEnabled,
      updatedAt: new Date(),
    })
    .where(eq(tenantConfig.teamId, tenantTeamId))

  return { accountId: cfg.stripeConnectAccountId, chargesEnabled, payoutsEnabled }
}

/**
 * Open a subscription Checkout session ON the tenant's connected account
 * (direct charges, no application fee). `childTeamId` is threaded through
 * metadata so the connect webhook can attribute the resulting subscription.
 */
export async function createConnectedCheckout(args: {
  connectAccountId: string
  priceId: string
  customerEmail: string
  childTeamId: string
  successUrl: string
  cancelUrl: string
}): Promise<{ url: string | null }> {
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price: args.priceId, quantity: 1 }],
      customer_email: args.customerEmail,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      metadata: { childTeamId: args.childTeamId },
      subscription_data: { metadata: { childTeamId: args.childTeamId } },
    } satisfies Stripe.Checkout.SessionCreateParams,
    { stripeAccount: args.connectAccountId },
  )
  return { url: session.url }
}
