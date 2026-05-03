// Webhook event handlers for Stripe.
// Each handler is called by /api/webhooks/stripe with the typed event payload.
// The webhook is the SINGLE SOURCE OF TRUTH for Instance status transitions.

import type Stripe from "stripe"
import {
  db,
  instances,
  instanceLogs,
  plans,
  subscriptions,
  eq,
} from "@/db"
import { provisionBot } from "@/lib/provisioner"
import { grantCredits } from "@/lib/credits"
import { describeVmError } from "@/lib/vm-provider"

// ---------- checkout.session.completed ----------
// Triggered when the user finishes paying. Flips Instance to "running",
// creates the Subscription row, writes a log entry.

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const metadata = (session.metadata ?? {}) as {
    instanceId?: string
    userId?: string
    planSlug?: string
    interval?: "month" | "year"
  }

  const instanceId = metadata.instanceId
  if (!instanceId) {
    console.warn("[stripe] checkout.session.completed missing instanceId in metadata")
    return
  }

  const instance = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
  })
  if (!instance) {
    console.warn(`[stripe] Instance ${instanceId} not found`)
    return
  }

  const plan = metadata.planSlug
    ? await db.query.plans.findFirst({ where: eq(plans.slug, metadata.planSlug) })
    : await db.query.plans.findFirst({ where: eq(plans.tier, "builder") })

  if (!plan) {
    console.warn("[stripe] No plan found for checkout session")
    return
  }

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null

  // Stamp the subscription id first so downstream provisioning has a record.
  if (stripeSubscriptionId) {
    await db
      .update(instances)
      .set({ stripeSubscriptionId })
      .where(eq(instances.id, instanceId))
  }

  // Real provision. In mock mode (no LINODE_API_TOKEN) this falls back to
  // assigning a mock IP and flipping status=running, preserving dev behavior.
  try {
    const fresh = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
    })
    if (fresh) {
      await provisionBot(fresh)
    }
  } catch (err) {
    // provisionBot handles its own rollback + state transition. Just log.
    console.error(
      `[stripe] provisionBot failed for ${instanceId}: ${await describeVmError(err)}`,
    )
  }

  // Create the Subscription row, linked 1:1 to the instance.
  const existingSub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.instanceId, instanceId),
  })
  if (existingSub) {
    await db
      .update(subscriptions)
      .set({
        stripeSubscriptionId: stripeSubscriptionId ?? undefined,
        status: "active",
        interval: metadata.interval ?? "month",
      })
      .where(eq(subscriptions.id, existingSub.id))
  } else {
    await db.insert(subscriptions).values({
      userId: instance.userId,
      planId: plan.id,
      instanceId,
      stripeSubscriptionId: stripeSubscriptionId ?? undefined,
      interval: metadata.interval ?? "month",
      status: "active",
    })
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: "Deployment provisioned via Stripe checkout. Status: running.",
  })
}

// ---------- customer.subscription.updated ----------

export async function handleSubscriptionUpdated(
  sub: Stripe.Subscription
): Promise<void> {
  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, sub.id),
  })
  if (!local) return
  await db
    .update(subscriptions)
    .set({
      status: sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .where(eq(subscriptions.id, local.id))
}

// ---------- customer.subscription.deleted ----------

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription
): Promise<void> {
  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, sub.id),
    with: { instance: true },
  })
  if (!local) return
  await db
    .update(subscriptions)
    .set({ status: "canceled" })
    .where(eq(subscriptions.id, local.id))
  if (local.instance) {
    // Only transition if the instance is currently running — respect the
    // state machine. A "deleting" / "deleted" / "failed_provisioning" row
    // should not be flipped back to stopped.
    if (local.instance.status === "running") {
      const { transitionInstance, logInstanceEvent } = await import(
        "@/lib/instance-state"
      )
      await transitionInstance(local.instance.id, ["running"], "stopped")
      await logInstanceEvent({
        instanceId: local.instance.id,
        level: "warn",
        stage: "subscription",
        action: "canceled",
        message: "Subscription canceled. Instance stopped.",
      })
    }
  }
}

// ---------- invoice.paid ----------

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id
  if (!subId) return
  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, subId),
    with: { plan: true },
  })
  if (!local) return
  await db
    .update(subscriptions)
    .set({ status: "active" })
    .where(eq(subscriptions.id, local.id))

  // Grant monthly credits for the renewal period.
  const credits = local.plan?.creditsPerPeriod ?? 0
  if (credits > 0) {
    const periodLabel = new Date().toISOString().slice(0, 7) // yyyy-mm
    try {
      await grantCredits(
        local.userId,
        credits,
        `subscription:${local.plan?.slug ?? "unknown"}:${periodLabel}:${invoice.id ?? "no-invoice"}`
      )
    } catch (err) {
      console.error(`[stripe] grantCredits failed for user ${local.userId}:`, err)
    }
  }
}

// ---------- invoice.payment_failed ----------

export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice
): Promise<void> {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id
  if (!subId) return
  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, subId),
    with: { instance: true },
  })
  if (!local) return
  await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(eq(subscriptions.id, local.id))
  if (local.instance) {
    await db.insert(instanceLogs).values({
      instanceId: local.instance.id,
      level: "error",
      message: "Payment failed. Subscription marked past_due.",
    })
  }
}
