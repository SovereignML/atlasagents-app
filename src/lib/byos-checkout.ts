// Stripe Checkout for a BYOS plan — one plan, one agent.
//
// Two callers, one session shape:
// - Buying a plan ahead of time (POST /api/byos/plans). `metadata.type =
//   "byos_plan"`; handleByosPlanCheckout records it as a FREE plan.
// - Installing with no free plan (POST /api/byos/deploy). Carries the pending
//   agent's `instanceId` and no `type`, so handlePaidSubscriptionCheckout
//   records the plan ASSIGNED to that agent and provisions it — the same
//   pay-then-provision path managed deploys use, including checkout-recovery.

import { db, users, eq } from "@/db"
import { stripe } from "@/lib/stripe"
import { planUnitAmountCents } from "@/lib/pricing"
import { BYOS_PLAN } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import { stripeIdempotencyKey, windowKey } from "@/lib/stripe-idempotency"

export type ByosCheckoutInput = {
  /** The plan's owner — the customer, also under impersonation. */
  userId: string
  interval: "month" | "year"
  /** The pending agent this plan is bought for, or absent for a free plan. */
  instance?: { id: string; name: string }
  successUrl: string
  cancelUrl: string
}

/** The customer's Stripe customer id, created on first use. */
async function ensureStripeCustomer(userId: string): Promise<string> {
  const userRow = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { stripeCustomerId: true, email: true },
  })
  if (userRow?.stripeCustomerId) return userRow.stripeCustomerId
  const customer = await stripe.customers.create(
    {
      // The OWNER's email — under impersonation session.user.email is the
      // admin's, and would stamp staff details onto the customer's record.
      email: userRow?.email ?? undefined,
      metadata: { userId },
    },
    { idempotencyKey: stripeIdempotencyKey("customer", userId, userRow?.email) },
  )
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, userId))
  return customer.id
}

/** Open a recurring Checkout Session for one BYOS plan. Returns its URL. */
export async function createByosPlanCheckout(input: ByosCheckoutInput): Promise<string | null> {
  const { userId, interval, instance } = input
  const customer = await ensureStripeCustomer(userId)
  const metadata: Record<string, string> = instance
    ? { instanceId: instance.id, userId, planSlug: "byos", interval }
    : { type: "byos_plan", userId, planSlug: "byos", interval }

  const checkout = await stripe.checkout.sessions.create(
    {
      customer,
      mode: "subscription",
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${BRANDING.name} Bring Your Own Server`,
              description: instance
                ? `Management plan for ${instance.name} · one agent on a server you own`
                : "Management plan for one agent on a server you own",
            },
            unit_amount: planUnitAmountCents(BYOS_PLAN, interval),
            recurring: { interval },
          },
          quantity: 1,
        },
      ],
      metadata,
      // Also on the subscription, so it is identifiable from Stripe's side
      // without going through the session.
      subscription_data: { metadata },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    },
    {
      // A double-click reuses the session; a deliberate second purchase a
      // minute later gets its own. An install's session is keyed on its agent.
      idempotencyKey: stripeIdempotencyKey(
        "byos-plan",
        instance?.id ?? userId,
        customer,
        interval,
        windowKey(),
      ),
    },
  )
  return checkout.url
}
