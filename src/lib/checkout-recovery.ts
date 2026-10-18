// Paid deploys must not depend on the Stripe webhook alone.
//
// A paid deploy creates a `pending` instance, sends the user to Stripe
// Checkout, and — until this module existed — provisioned ONLY when
// `checkout.session.completed` reached /api/webhooks/stripe. A missed, rejected
// or misrouted webhook left a paying customer staring at a "deploying" page
// forever: nothing else ever moved a `pending` row, and the retry endpoint
// refuses `pending`.
//
// This asks Stripe directly. For a `pending` instance, find the Checkout
// Session whose metadata names it; if Stripe says it is paid, run the same
// handler the webhook runs. That handler claims `stripe_checkout:<session.id>`,
// so the webhook and this path can race freely — whichever claims first
// processes the payment, the other no-ops.
//
// BYOS plans bought ahead of an install get the same treatment. Such a plan is
// not tied to an instance, so there is no `pending` row to find: the BYOS page
// (the plan's success_url) asks about the customer's sessions, and the sweep
// scans recent paid `byos_plan` sessions that never produced a Subscription
// row. A plan bought AT install carries the pending agent's instanceId, so the
// instance path above covers it.

import type Stripe from "stripe"
import { db, instances, subscriptions, users, eq, and, gt } from "@/db"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { handleCheckoutSessionCompleted } from "@/lib/stripe-events"

/** Checkout Sessions expire after 24h, so an older `pending` row can't be paid. */
const MAX_PENDING_AGE_MS = 25 * 60 * 60 * 1000
/** Give the webhook first shot before the background sweep asks Stripe. */
const SWEEP_GRACE_MS = 60_000
/** Per-instance floor between Stripe lookups (page loads can be frequent). */
const LOOKUP_MIN_INTERVAL_MS = 30_000

const lastLookupAt = new Map<string, number>()

function isPaid(s: Stripe.Checkout.Session): boolean {
  return (
    s.status === "complete" &&
    (s.payment_status === "paid" || s.payment_status === "no_payment_required")
  )
}

async function findPaidSession(
  instanceId: string,
  userId: string,
  createdAt: Date,
): Promise<Stripe.Checkout.Session | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { stripeCustomerId: true },
  })
  if (!user?.stripeCustomerId) return null

  const sessions = await stripe.checkout.sessions.list({
    customer: user.stripeCustomerId,
    created: { gte: Math.floor(createdAt.getTime() / 1000) - 60 },
    limit: 100,
  })
  return sessions.data.find((s) => s.metadata?.instanceId === instanceId && isPaid(s)) ?? null
}

/**
 * If `instanceId` is `pending` and Stripe holds a paid Checkout Session for it,
 * start provisioning (in the background — it takes minutes). Returns whether it
 * did. Never throws; throttled per instance.
 */
export async function recoverPaidCheckout(instanceId: string): Promise<boolean> {
  if (!isStripeConfigured()) return false
  const now = Date.now()
  if (now - (lastLookupAt.get(instanceId) ?? 0) < LOOKUP_MIN_INTERVAL_MS) return false
  lastLookupAt.set(instanceId, now)

  try {
    const instance = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
      columns: { id: true, status: true, userId: true, createdAt: true },
    })
    if (!instance || instance.status !== "pending") return false
    if (now - instance.createdAt.getTime() > MAX_PENDING_AGE_MS) return false

    const session = await findPaidSession(instance.id, instance.userId, instance.createdAt)
    if (!session) return false

    console.warn(
      `[checkout-recovery] ${instance.id} is pending but Stripe session ${session.id} is paid — ` +
        `the webhook never processed it. Provisioning now.`,
    )
    void handleCheckoutSessionCompleted(session).catch((err) => {
      console.error(`[checkout-recovery] handler failed for ${instance.id}:`, err)
    })
    return true
  } catch (err) {
    console.error(`[checkout-recovery] lookup failed for ${instanceId}:`, err)
    return false
  }
}

function isByosPlanSession(s: Stripe.Checkout.Session): boolean {
  return s.metadata?.type === "byos_plan" && isPaid(s)
}

/** Whether a paid session's subscription already has a local row. */
async function isRecorded(session: Stripe.Checkout.Session): Promise<boolean> {
  const subId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id
  if (!subId) return true // nothing to record against
  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, subId),
    columns: { id: true },
  })
  return !!local
}

/**
 * The customer just came back from buying a BYOS plan (the BYOS page is that
 * checkout's success_url). If Stripe holds paid `byos_plan` sessions of theirs
 * that never produced a Subscription row — the webhook hasn't landed, or never
 * will — record them now. Awaited: it is a few DB writes, and the caller
 * re-reads the plans straight after. Never throws; throttled per user.
 */
export async function recoverByosPlanCheckouts(userId: string): Promise<boolean> {
  if (!isStripeConfigured()) return false
  const key = `byos_plan:${userId}`
  const now = Date.now()
  if (now - (lastLookupAt.get(key) ?? 0) < LOOKUP_MIN_INTERVAL_MS) return false
  lastLookupAt.set(key, now)

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { stripeCustomerId: true },
    })
    if (!user?.stripeCustomerId) return false
    const sessions = await stripe.checkout.sessions.list({
      customer: user.stripeCustomerId,
      created: { gte: Math.floor((now - MAX_PENDING_AGE_MS) / 1000) },
      limit: 100,
    })
    let recovered = false
    for (const session of sessions.data) {
      if (!isByosPlanSession(session) || (await isRecorded(session))) continue
      console.warn(
        `[checkout-recovery] BYOS plan session ${session.id} is paid but unrecorded — ` +
          `the webhook never processed it. Recording now.`,
      )
      await handleCheckoutSessionCompleted(session)
      recovered = true
    }
    return recovered
  } catch (err) {
    console.error(`[checkout-recovery] BYOS plan lookup failed for user ${userId}:`, err)
    return false
  }
}

/**
 * Background sweep for BYOS plans: paid `byos_plan` sessions from the last day,
 * past the webhook's grace window, whose subscription has no local row.
 */
export async function sweepPaidByosPlanCheckouts(): Promise<number> {
  if (!isStripeConfigured()) return 0
  const now = Date.now()
  const sessions = await stripe.checkout.sessions.list({
    status: "complete",
    created: { gte: Math.floor((now - MAX_PENDING_AGE_MS) / 1000) },
    limit: 100,
  })
  let recovered = 0
  for (const session of sessions.data) {
    if (!isByosPlanSession(session)) continue
    if (now - session.created * 1000 < SWEEP_GRACE_MS) continue
    if (await isRecorded(session)) continue
    try {
      await handleCheckoutSessionCompleted(session)
      recovered++
    } catch (err) {
      console.error(`[checkout-recovery] BYOS plan sweep failed for ${session.id}:`, err)
    }
  }
  return recovered
}

/** Background sweep: every recent `pending` row past the webhook's grace window. */
export async function sweepPendingPaidCheckouts(): Promise<number> {
  if (!isStripeConfigured()) return 0
  const now = Date.now()
  const rows = await db.query.instances.findMany({
    where: and(
      eq(instances.status, "pending"),
      gt(instances.createdAt, new Date(now - MAX_PENDING_AGE_MS)),
    ),
    columns: { id: true, createdAt: true },
    limit: 50,
  })
  let recovered = 0
  for (const row of rows) {
    if (now - row.createdAt.getTime() < SWEEP_GRACE_MS) continue
    if (await recoverPaidCheckout(row.id)) recovered++
  }
  return recovered
}
