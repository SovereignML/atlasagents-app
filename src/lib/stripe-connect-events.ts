// Handlers for CONNECTED-account Stripe events (reseller billing). These arrive
// on a separate webhook endpoint (/api/webhooks/stripe-connect) with the
// connected account id in `event.account`.
//
// Critical difference from platform events (src/lib/stripe-events.ts): reseller
// money is the TENANT's, so these NEVER fund the platform wallet or mint/extend
// platform OpenRouter caps. They only record the child end-customer's
// subscription state (entitlement) into the `subscriptions` table with
// connectAccountId + teamId set and planId null.

import type Stripe from "stripe"
import { db, eq, and, subscriptions, teams, tenantConfig, tenantPlans } from "@/db"

/**
 * Stamp a child team's entitlement (agent/seat caps) from a tenant plan. Called
 * when a Connect subscription activates. `getTeamSeatLimit` honors an explicit
 * `teams.seatLimit` before any subscription tier, so this is all that's needed
 * for the child's caps to take effect — no platform wallet involved.
 */
async function applyTenantPlanEntitlement(
  childTeamId: string,
  tenantPlanId: string | undefined,
): Promise<void> {
  if (!tenantPlanId) return
  const plan = await db.query.tenantPlans.findFirst({
    where: eq(tenantPlans.id, tenantPlanId),
    columns: { agentLimit: true, seatLimit: true },
  })
  if (!plan) return
  await db
    .update(teams)
    .set({ agentLimit: plan.agentLimit ?? null, seatLimit: plan.seatLimit ?? null })
    .where(eq(teams.id, childTeamId))
}

/** Sync charges/payouts-enabled flags when a connected account updates. */
export async function handleConnectAccountUpdated(account: Stripe.Account): Promise<void> {
  const cfg = await db.query.tenantConfig.findFirst({
    where: eq(tenantConfig.stripeConnectAccountId, account.id),
    columns: { teamId: true },
  })
  if (!cfg) return
  await db
    .update(tenantConfig)
    .set({
      stripeConnectChargesEnabled: Boolean(account.charges_enabled),
      stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
      updatedAt: new Date(),
    })
    .where(eq(tenantConfig.teamId, cfg.teamId))
}

/** Record a child end-customer's new subscription from a completed checkout. */
export async function handleConnectCheckoutCompleted(
  session: Stripe.Checkout.Session,
  accountId: string | undefined,
): Promise<void> {
  const childTeamId = session.metadata?.childTeamId
  const tenantPlanId = session.metadata?.tenantPlanId
  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id
  if (!childTeamId || !subId || !accountId) return

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, childTeamId),
    columns: { ownerId: true },
  })
  if (!team) return

  await db
    .insert(subscriptions)
    .values({
      userId: team.ownerId,
      teamId: childTeamId,
      connectAccountId: accountId,
      stripeSubscriptionId: subId,
      status: "active",
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: { status: "active", teamId: childTeamId, connectAccountId: accountId, updatedAt: new Date() },
    })

  // Stamp the child team's caps from the chosen plan. No platform wallet/credits
  // — LLM is billed to the tenant's OpenRouter key; this only governs limits.
  await applyTenantPlanEntitlement(childTeamId, tenantPlanId)
}

/** Mark a connected subscription past_due on a failed renewal payment. */
export async function handleConnectInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  accountId: string | undefined,
): Promise<void> {
  if (!accountId) return
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id
  if (!subId) return
  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.stripeSubscriptionId, subId),
        eq(subscriptions.connectAccountId, accountId),
      ),
    )
}

/** Sync a connected subscription's status/period on update. */
export async function handleConnectSubscriptionUpdated(
  sub: Stripe.Subscription,
  accountId: string | undefined,
): Promise<void> {
  if (!accountId) return
  const periodEnd =
    typeof sub.current_period_end === "number"
      ? new Date(sub.current_period_end * 1000)
      : null
  // Scope to the row on THIS connected account — a connect event must never
  // mutate a platform row (or another tenant's row) that shares an id namespace.
  await db
    .update(subscriptions)
    .set({
      status: sub.status,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      currentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.stripeSubscriptionId, sub.id),
        eq(subscriptions.connectAccountId, accountId),
      ),
    )
}

/** Mark a connected subscription canceled. */
export async function handleConnectSubscriptionDeleted(
  sub: Stripe.Subscription,
  accountId: string | undefined,
): Promise<void> {
  if (!accountId) return
  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.stripeSubscriptionId, sub.id),
        eq(subscriptions.connectAccountId, accountId),
      ),
    )
}
