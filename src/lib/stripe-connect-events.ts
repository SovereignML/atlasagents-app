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
import { db, eq, subscriptions, teams, tenantConfig } from "@/db"

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
}

/** Sync a connected subscription's status/period on update. */
export async function handleConnectSubscriptionUpdated(
  sub: Stripe.Subscription,
): Promise<void> {
  const periodEnd =
    typeof sub.current_period_end === "number"
      ? new Date(sub.current_period_end * 1000)
      : null
  await db
    .update(subscriptions)
    .set({
      status: sub.status,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      currentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
}

/** Mark a connected subscription canceled. */
export async function handleConnectSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
}
