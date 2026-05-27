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
  users,
  eq,
} from "@/db"
import { stripe } from "@/lib/stripe"
import { provisionBot } from "@/lib/provisioner"
import { fundWallet } from "@/lib/openrouter-billing"
import { clawBackFunds } from "@/lib/billing"
import { describeVmError } from "@/lib/vm-provider"
import { usdToCredits } from "@/lib/credit-pricing"
import { notify } from "@/lib/notifications/dispatch"
import { createAdminNotification } from "@/lib/admin-notify"

// ---------- checkout.session.completed ----------
// Triggered when the user finishes paying. Flips Instance to "running",
// creates the Subscription row, writes a log entry.
//
// Also handles wallet top-up checkouts (metadata.type === "wallet_topup").

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const metadata = (session.metadata ?? {}) as {
    instanceId?: string
    userId?: string
    planSlug?: string
    interval?: "month" | "year"
    type?: string
  }

  // ── Wallet top-up checkout ──
  if (metadata.type === "wallet_topup" && metadata.userId) {
    const amountCents = session.amount_total ?? 0
    if (amountCents > 0) {
      const amountUsd = amountCents / 100
      const credits = usdToCredits(amountUsd)
      // fundWallet = deposit + raise/re-enable the user's OpenRouter caps.
      await fundWallet(
        metadata.userId,
        credits,
        "topup",
        `Top-up: $${amountUsd.toFixed(2)} → ${credits.toLocaleString()} credits`,
      )
      console.log(
        `[stripe] Wallet top-up ${credits} credits ($${amountUsd.toFixed(2)}) for user ${metadata.userId}`,
      )
    }
    return
  }

  // ── Subscription checkout (existing flow) ──
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

  if (stripeSubscriptionId) {
    await db
      .update(instances)
      .set({ stripeSubscriptionId })
      .where(eq(instances.id, instanceId))
  }

  try {
    const fresh = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
    })
    if (fresh) {
      await provisionBot(fresh)
    }
  } catch (err) {
    console.error(
      `[stripe] provisionBot failed for ${instanceId}: ${await describeVmError(err)}`,
    )
  }

  // Atomic upsert keyed on the existing unique index Subscription_instanceId_key.
  // Replaces a read-then-insert-or-update race where two concurrent webhook
  // deliveries could both observe `existingSub = null` and both INSERT,
  // tripping the unique constraint on the loser.
  await db
    .insert(subscriptions)
    .values({
      userId: instance.userId,
      planId: plan.id,
      instanceId,
      stripeSubscriptionId: stripeSubscriptionId ?? undefined,
      interval: metadata.interval ?? "month",
      status: "active",
    })
    .onConflictDoUpdate({
      target: subscriptions.instanceId,
      set: {
        stripeSubscriptionId: stripeSubscriptionId ?? undefined,
        status: "active",
        interval: metadata.interval ?? "month",
      },
    })

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

  if (local.instance && local.instance.status === "running") {
    const { isAboveMinimum } = await import("@/lib/wallet")

    const hasWalletFunds = await isAboveMinimum(local.userId)
    if (hasWalletFunds) {
      // Wallet has enough balance -- keep instance running on wallet billing.
      const { logInstanceEvent } = await import("@/lib/instance-state")
      await logInstanceEvent({
        instanceId: local.instance.id,
        level: "info",
        stage: "subscription",
        action: "canceled_wallet_fallback",
        message:
          "Subscription canceled. Instance continues running on wallet balance.",
      })
      // Notify admin that this user's subscription ended but instance is still live.
      const { createAdminNotification } = await import("@/lib/admin-notify")
      await createAdminNotification({
        type: "invoice_needed",
        userId: local.userId,
        instanceId: local.instance.id,
        message: `Subscription canceled for instance "${local.instance.name}". Instance is running on wallet balance.`,
      })
      await notify({
        userId: local.userId,
        category: "billing",
        type: "subscription_canceled",
        title: "Subscription canceled",
        message: `Your subscription for "${local.instance.name}" was canceled. The agent will keep running on your wallet balance.`,
        url: "/dashboard/billing",
        instanceId: local.instance.id,
      })
      return
    }

    // Wallet too low -- stop the instance.
    const { pauseBot } = await import("@/lib/provisioner")
    const { logInstanceEvent } = await import("@/lib/instance-state")
    try {
      await pauseBot(local.instance)
    } catch (err) {
      console.warn(
        `[stripe] pauseBot failed for ${local.instance.id}:`,
        err,
      )
    }
    await logInstanceEvent({
      instanceId: local.instance.id,
      level: "warn",
      stage: "subscription",
      action: "canceled",
      message: "Subscription canceled. Wallet balance insufficient. Instance stopped.",
    })
    const { createAdminNotification } = await import("@/lib/admin-notify")
    await createAdminNotification({
      type: "instance_stopped",
      userId: local.userId,
      instanceId: local.instance.id,
      message: `Subscription canceled and wallet empty for instance "${local.instance.name}". Instance stopped. Send invoice to customer.`,
    })
    await notify({
      userId: local.userId,
      category: "billing",
      type: "subscription_canceled",
      title: `Agent "${local.instance.name}" stopped`,
      message:
        "Your subscription was canceled and your wallet balance is insufficient, so the agent has been stopped. Add credits to resume.",
      url: "/dashboard/billing",
      instanceId: local.instance.id,
    })
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
    with: { plan: true, instance: { with: { serverConfig: true } } },
  })
  if (!local) return
  await db
    .update(subscriptions)
    .set({ status: "active" })
    .where(eq(subscriptions.id, local.id))

  // Deposit the plan's monthly credit allotment. ONE deposit per invoice —
  // no more dual writes to User.credits + Wallet.balance.
  const credits = local.plan?.creditsPerPeriod ?? 0
  if (credits > 0) {
    const periodLabel = new Date().toISOString().slice(0, 7) // yyyy-mm
    try {
      await fundWallet(
        local.userId,
        credits,
        "plan_deposit",
        `Plan renewal: ${local.plan?.name ?? "unknown"} (${periodLabel})`,
        (local.instance as { id?: string } | null)?.id,
      )
      console.log(
        `[stripe] Granted ${credits.toLocaleString()} credits to user ${local.userId} (invoice ${invoice.id})`,
      )
    } catch (err) {
      console.error(`[stripe] depositToWallet failed for user ${local.userId}:`, err)
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
  await notify({
    userId: local.userId,
    category: "billing",
    type: "payment_failed",
    title: "Payment failed",
    message: `We couldn't process your latest payment${local.instance ? ` for "${local.instance.name}"` : ""}. Please update your payment method to avoid interruption.`,
    url: "/dashboard/billing",
    instanceId: local.instance?.id,
  })
}

// ---------- payment-reversal clawbacks ----------
// Refunds, lost disputes, and voided paid invoices must reverse the credits we
// granted on invoice.paid / checkout — otherwise a user keeps (and spends)
// credits they were refunded for. Idempotency is guaranteed upstream by
// claimEvent(event.id) in the webhook route.

function stripeIdOf(
  ref: string | { id: string } | null | undefined,
): string | null {
  if (!ref) return null
  return typeof ref === "string" ? ref : ref.id
}

async function findUserIdByStripeCustomer(
  customer: string | { id: string } | null | undefined,
): Promise<string | null> {
  const customerId = stripeIdOf(customer)
  if (!customerId) return null
  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
    columns: { id: true },
  })
  return user?.id ?? null
}

/**
 * Reverse credits after a payment reversal (refund / lost dispute / voided paid
 * invoice). Delegates the money + cap mechanics to `clawBackFunds` (settlement
 * deduction + un-fund + lower the OpenRouter cap) and owns only the
 * admin/user notifications + manual-reconcile alert for any shortfall.
 */
async function clawBackCredits(
  userId: string,
  usd: number,
  reason: string,
): Promise<void> {
  const result = await clawBackFunds(userId, usd, reason)
  if (result.creditsRequested <= 0) return
  const clawed = result.creditsRequested - result.shortfall
  await createAdminNotification({
    type: "invoice_needed",
    userId,
    message:
      `${reason}. Clawed back ${clawed.toLocaleString()} credits` +
      (result.shortfall > 0
        ? ` — wallet short by ${result.shortfall.toLocaleString()} credits; reconcile manually.`
        : "."),
    meta: { reason, creditsRequested: result.creditsRequested, creditsClawed: clawed, shortfall: result.shortfall },
  })
  await notify({
    userId,
    category: "billing",
    type: "credits_adjusted",
    title: "Credit balance adjusted",
    message: `${reason}. Your credit balance was adjusted accordingly.`,
    url: "/dashboard/billing",
  })
}

// ---------- charge.refunded ----------

export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const userId = await findUserIdByStripeCustomer(charge.customer)
  if (!userId) {
    console.warn(`[stripe] charge.refunded: no user for customer ${stripeIdOf(charge.customer)}`)
    return
  }
  // Claw back only the most recent refund's amount, not the cumulative
  // amount_refunded — each partial refund is a distinct (deduped) event.
  const latestRefundCents = charge.refunds?.data?.[0]?.amount ?? charge.amount_refunded
  await clawBackCredits(
    userId,
    latestRefundCents / 100,
    `Refund of $${(latestRefundCents / 100).toFixed(2)} (charge ${charge.id})`,
  )
}

// ---------- charge.dispute.created ----------
// Funds are held but not yet lost — alert admins to submit evidence. Do NOT
// claw back here; we only reverse credits if the dispute is actually lost.

export async function handleChargeDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const charge =
    typeof dispute.charge === "string"
      ? await stripe.charges.retrieve(dispute.charge).catch(() => null)
      : dispute.charge
  const userId = await findUserIdByStripeCustomer(charge?.customer)
  await createAdminNotification({
    type: "invoice_needed",
    userId: userId ?? "unknown",
    message: `Dispute opened: $${(dispute.amount / 100).toFixed(2)} (charge ${stripeIdOf(dispute.charge)}, reason ${dispute.reason}). Submit evidence in Stripe before the deadline.`,
    meta: { disputeId: dispute.id, amount: dispute.amount, reason: dispute.reason },
  })
}

// ---------- charge.dispute.closed ----------

export async function handleChargeDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  const charge =
    typeof dispute.charge === "string"
      ? await stripe.charges.retrieve(dispute.charge).catch(() => null)
      : dispute.charge
  const userId = await findUserIdByStripeCustomer(charge?.customer)
  if (dispute.status === "lost" && userId) {
    await clawBackCredits(
      userId,
      dispute.amount / 100,
      `Lost dispute $${(dispute.amount / 100).toFixed(2)} (charge ${stripeIdOf(dispute.charge)})`,
    )
    return
  }
  // Won / warning-closed: no clawback, just record the outcome.
  await createAdminNotification({
    type: "invoice_needed",
    userId: userId ?? "unknown",
    message: `Dispute closed (${dispute.status}): $${(dispute.amount / 100).toFixed(2)} (charge ${stripeIdOf(dispute.charge)}). No credit clawback.`,
    meta: { disputeId: dispute.id, status: dispute.status },
  })
}

// ---------- invoice.voided ----------
// Voiding an already-paid invoice reverses the payment; claw back what it paid.
// An unpaid void (the common case) granted no credits, so it's a no-op.

export async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
  const amountPaidCents = invoice.amount_paid ?? 0
  if (amountPaidCents <= 0) return
  const userId = await findUserIdByStripeCustomer(invoice.customer)
  if (!userId) {
    console.warn(`[stripe] invoice.voided: no user for customer ${stripeIdOf(invoice.customer)}`)
    return
  }
  await clawBackCredits(
    userId,
    amountPaidCents / 100,
    `Voided invoice $${(amountPaidCents / 100).toFixed(2)} (invoice ${invoice.id})`,
  )
}
