// Webhook event handlers for Stripe.
// Each handler is called by /api/webhooks/stripe with the typed event payload.
// The webhook is the SINGLE SOURCE OF TRUTH for Instance status transitions.

import type Stripe from "stripe"
import {
  db,
  byosServers,
  instances,
  instanceLogs,
  plans,
  subscriptions,
  users,
  eq,
} from "@/db"
import { stripe } from "@/lib/stripe"
import { provisionBot } from "@/lib/provisioner"
import { ensureProvisioningFailed } from "@/lib/instance-state"
import { fundWallet } from "@/lib/openrouter-billing"
import { clawBackFunds } from "@/lib/billing"
import { describeVmError } from "@/lib/vm-provider"
import { usdToCredits } from "@/lib/credit-pricing"
import { BYOS_SIGNUP_CREDITS } from "@/configs/plans"
import { notify, nothingDelivered } from "@/lib/notifications/dispatch"
import { createAdminNotification } from "@/lib/admin-notify"
import { claimEvent, releaseEvent } from "@/lib/idempotency"
import { posthogServer } from "@/lib/posthog-server"
import { adsConversions } from "@/lib/ads"
import { creditGrantSchedule } from "@/lib/plan-period"

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
    byosServerId?: string
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

  // ── BYOS plan for a connected server (no instance involved) ──
  // Same session claim as the instance path below: the webhook and
  // checkout-recovery can both deliver this session.
  if (metadata.type === "byos_plan") {
    if (!(await claimEvent("stripe_checkout", session.id))) return
    try {
      await handleByosPlanCheckout(session, metadata)
    } catch (err) {
      await releaseEvent("stripe_checkout", session.id)
      throw err
    }
    return
  }

  // ── Subscription checkout (existing flow) ──
  const instanceId = metadata.instanceId
  if (!instanceId) {
    console.warn("[stripe] checkout.session.completed missing instanceId in metadata")
    return
  }

  // Two paths deliver a paid session here: the webhook and checkout-recovery
  // (which asks Stripe directly when the webhook never arrives). Claim the
  // session itself — not the webhook event id — so they can't both process it.
  // Released on error so either path can re-attempt.
  if (!(await claimEvent("stripe_checkout", session.id))) return
  try {
    await handlePaidSubscriptionCheckout(session, instanceId, metadata)
  } catch (err) {
    await releaseEvent("stripe_checkout", session.id)
    throw err
  }
}

async function handlePaidSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  instanceId: string,
  metadata: { planSlug?: string; interval?: "month" | "year" },
): Promise<void> {
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

  // A BYOS plan bought at install, for an agent deleted before the payment
  // landed: the customer has paid for a plan, so record it — as an AVAILABLE plan
  // their next install takes, not one tied to an agent that no longer exists.
  if (plan.tier === "byos" && instance.status === "deleted") {
    await handleByosPlanCheckout(session, {
      userId: instance.userId,
      interval: metadata.interval,
    })
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

  // Provisioning failure must NOT be silent. This used to catch, log to stderr
  // and carry on — so the row could sit in `provisioning` forever while the
  // instance log below cheerfully claimed "Status: running." The subscription
  // upsert still runs either way (the customer HAS paid and IS subscribed;
  // that is independent of whether the box came up), but the outcome is now
  // recorded on the instance so the dashboard, the retry endpoint and the
  // reconciler all see the truth.
  let provisionError: string | null = null
  try {
    const fresh = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
    })
    // Only a `pending` row is waiting on this payment. Anything else is already
    // being (or was) provisioned — calling provisionBot again would contend the
    // lock and the catch below would mark a healthy deploy failed.
    if (fresh?.status === "pending") {
      await provisionBot(fresh)
    }
  } catch (err) {
    provisionError = await describeVmError(err)
    console.error(`[stripe] provisionBot failed for ${instanceId}: ${provisionError}`)
    // rollbackProvisioning already marks most failures, but throws that happen
    // before a target provisioner runs (lock contention, a bad row) skip it.
    // This is idempotent and no-ops when the status is already terminal.
    await ensureProvisioningFailed(instanceId, provisionError)
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

  // Grant the first invoice's plan credits HERE, not only from invoice.paid.
  // Stripe does not order events: invoice.paid routinely lands before this
  // handler has created the Subscription row, finds nothing, returns 200 — and
  // the credits are never granted (the event is claimed, so a resend no-ops).
  // Running the same handler now, with the row in place, closes that race.
  // Idempotent: both paths share the `invoice_grant:<invoice.id>` claim.
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ["latest_invoice"],
    })
    const invoice = sub.latest_invoice
    if (invoice && typeof invoice !== "string" && invoice.status === "paid") {
      await handleInvoicePaid(invoice)
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: provisionError ? "error" : "info",
    message: provisionError
      ? `Payment succeeded, but provisioning failed: ${provisionError}. ` +
        `Your subscription is active — retry the deployment from the agent page.`
      : "Deployment provisioned via Stripe checkout. Status: running.",
  })

  // Fire-and-forget analytics; no-op when PostHog isn't configured.
  posthogServer.capture({
    distinctId: instance.userId,
    event: "subscription_changed",
    properties: {
      action: "created",
      plan: plan.slug,
      interval: metadata.interval ?? "month",
      instanceId,
    },
  })

  await trackPurchaseConversion(instance.userId, session)
}

/**
 * Ad-conversion: report the purchase to Meta/Google. This webhook has NO
 * browser context, so attribution relies on the click IDs + consent we stored
 * on the user at signup. Best-effort, gated on marketing consent; no-op when
 * ads aren't configured.
 */
async function trackPurchaseConversion(
  userId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  try {
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        email: true,
        fbclid: true,
        gclid: true,
        adClickCapturedAt: true,
        marketingConsent: true,
      },
    })
    if (buyer && buyer.marketingConsent === true && (session.amount_total ?? 0) > 0) {
      adsConversions.trackPurchase({
        eventKey: session.id,
        email: buyer.email,
        consent: true,
        value: (session.amount_total ?? 0) / 100,
        currency: (session.currency ?? "usd").toUpperCase(),
        clickIds: {
          fbclid: buyer.fbclid,
          gclid: buyer.gclid,
          capturedAtMs: buyer.adClickCapturedAt?.getTime(),
        },
      })
    }
  } catch (err) {
    console.error("[stripe] ad-conversion tracking failed:", err)
  }
}

// ---------- checkout.session.completed: BYOS plan ----------
// A BYOS plan bought ahead of an install. Recorded as an AVAILABLE plan (no
// instanceId, no server) — /api/byos/deploy assigns it to the next agent.
// Nothing is provisioned here. A plan bought AT install carries an instanceId
// instead and goes through handlePaidSubscriptionCheckout.
//
// Sessions opened before per-agent plans carry `byosServerId`; one paid after
// the switch is still recorded against its server, as the grandfathered
// per-server plan the customer was shown.

async function handleByosPlanCheckout(
  session: Stripe.Checkout.Session,
  metadata: { userId?: string; byosServerId?: string; interval?: "month" | "year" },
): Promise<void> {
  const { byosServerId, userId } = metadata
  if (!userId) {
    console.warn(`[stripe] byos_plan checkout ${session.id} missing userId`)
    return
  }
  const plan = await db.query.plans.findFirst({ where: eq(plans.slug, "byos") })
  if (!plan) {
    // Throw (not return) so the claim is released and Stripe retries once the
    // plan row exists — the customer has paid.
    throw new Error(`[stripe] byos plan row missing for checkout ${session.id}`)
  }
  const server = byosServerId
    ? await db.query.byosServers.findFirst({
        where: eq(byosServers.id, byosServerId),
        columns: { id: true },
      })
    : null

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null
  if (!stripeSubscriptionId) {
    throw new Error(`[stripe] byos_plan checkout ${session.id} has no subscription`)
  }

  // customer.subscription.updated can land before this row exists and finds
  // nothing, so take the period and cancel flag from Stripe now.
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  const interval = metadata.interval ?? "month"
  const values = {
    status: sub.status,
    interval,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    byosServerId: server?.id ?? null,
  }
  await db
    .insert(subscriptions)
    .values({ userId, planId: plan.id, stripeSubscriptionId, ...values })
    .onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: values })

  console.log(`[stripe] BYOS plan ${stripeSubscriptionId} active (user ${userId})`)
  await notify({
    userId,
    category: "billing",
    type: "byos_plan_active",
    title: "BYOS plan active",
    message: "You can install one more agent on a server you own.",
    url: "/dashboard/byos",
  })

  posthogServer.capture({
    distinctId: userId,
    event: "subscription_changed",
    properties: { action: "created", plan: "byos", interval },
  })
  await trackPurchaseConversion(userId, session)
}

// ---------- customer.subscription.updated ----------

export async function handleSubscriptionUpdated(
  sub: Stripe.Subscription
): Promise<void> {
  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, sub.id),
  })
  if (!local) return
  // Reseller (Stripe Connect) subscriptions are owned by the tenant's connected
  // account and handled exclusively by the connect webhook. A connected event
  // must never be processed here (see handleConnect* in stripe-connect-events.ts).
  if (local.connectAccountId) return
  await db
    .update(subscriptions)
    .set({
      status: sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .where(eq(subscriptions.id, local.id))

  posthogServer.capture({
    distinctId: local.userId,
    event: "subscription_changed",
    properties: {
      action: "updated",
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      instanceId: local.instanceId,
    },
  })
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
  // Reseller (Connect) subscriptions belong to the connect webhook only.
  if (local.connectAccountId) return
  await db
    .update(subscriptions)
    .set({ status: "canceled" })
    .where(eq(subscriptions.id, local.id))

  posthogServer.capture({
    distinctId: local.userId,
    event: "subscription_changed",
    properties: {
      action: "canceled",
      status: "canceled",
      instanceId: local.instanceId,
    },
  })

  // BYOS: an agent runs for as long as it has a plan (byosAgentIsCovered). A
  // plan ending re-checks every agent on its server, since grandfathered agents
  // can lean on a server's plan or on a sibling's; an available plan ending
  // stops nothing. No wallet fallback: BYOS has no compute to bill the wallet
  // for, so a wallet balance is not a plan.
  if (local.byosServerId || local.instance?.deploymentTarget === "byos") {
    const { byosAgentIdsOnServer, stopUncoveredByosAgents } = await import("@/lib/byos-plan")
    const serverId = local.byosServerId ?? local.instance!.byosServerId
    const agentIds = serverId ? await byosAgentIdsOnServer(serverId) : [local.instance!.id]
    await stopUncoveredByosAgents(agentIds)
    return
  }

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
  // Never fund the platform wallet from a reseller (Connect) invoice — that money
  // is the tenant's, paid to the tenant's own connected account. This replaces
  // the fragile implicit invariant (reseller rows have planId=null → 0 credits)
  // with an explicit guard. The connect webhook owns these rows.
  if (local.connectAccountId) return
  await db
    .update(subscriptions)
    .set({ status: "active" })
    .where(eq(subscriptions.id, local.id))

  // Deposit the plan's credit allotment. The FIRST invoice of a subscription
  // (`billing_reason === "subscription_create"`) is a NEW grant that must stack
  // on the wallet — otherwise deploying a second agent would expire the first
  // agent's plan credits and reset the bucket, so credits never increase. A
  // RENEWAL (`subscription_cycle`) keeps use-it-or-lose-it: expire the prior
  // period's unspent plan credits, then add the new allotment.
  const credits = local.plan?.creditsPerPeriod ?? 0
  if (credits > 0) {
    const isNewSubscription = invoice.billing_reason === "subscription_create"
    const planMode = isNewSubscription ? "add" : "renew"
    const periodLabel = new Date().toISOString().slice(0, 7) // yyyy-mm
    const action = isNewSubscription ? "grant" : "renewal"
    // Yearly plans prepay 12 months but the allotment is distributed monthly:
    // this deposits only the first month (expiring in a month) and seeds
    // `nextCreditGrantAt` so the monthly-grants sweep drips the rest. Monthly
    // plans deposit the full allotment expiring at the Stripe period end.
    const { expireAt, nextCreditGrantAt } = creditGrantSchedule(
      local.interval,
      local.currentPeriodEnd ?? null,
    )
    // Let a failed deposit propagate so the route releases the event claim and
    // Stripe retries (a 500). Guard with a per-invoice sub-claim so a partial
    // failure elsewhere in this handler can't double-grant on retry: `planMode:
    // "add"` stacks deposits, so re-running an already-succeeded grant would
    // over-credit. The deposit and the `nextCreditGrantAt` update share one
    // failure domain — if the deposit throws, the drip schedule is not updated.
    const grantKey = `invoice_grant:${invoice.id}`
    if (await claimEvent("stripe", grantKey)) {
      try {
        await fundWallet(
          local.userId,
          credits,
          "plan_deposit",
          `Plan ${action}: ${local.plan?.name ?? "unknown"} (${periodLabel})`,
          (local.instance as { id?: string } | null)?.id,
          { planExpiry: expireAt, planMode },
        )
        // Reset the drip schedule: a yearly (re)deposit re-seeds it; a monthly one
        // clears it (Stripe's monthly invoice is the renewal, not a drip).
        await db
          .update(subscriptions)
          .set({ nextCreditGrantAt })
          .where(eq(subscriptions.id, local.id))
        console.log(
          `[stripe] Granted ${credits.toLocaleString()} credits to user ${local.userId} (invoice ${invoice.id}, ${planMode}, interval ${local.interval})`,
        )
      } catch (err) {
        await releaseEvent("stripe", grantKey)
        throw err
      }
    }
  }

  // BYOS users on managed AI (no own key) get a one-time starter grant on their
  // FIRST invoice. After that they top up like any other wallet user. Own-key
  // BYOS users pay their provider directly, so no grant.
  const byosInstance = local.instance as { id?: string; byosLlmMode?: string | null } | null
  if (
    local.plan?.tier === "byos" &&
    byosInstance?.byosLlmMode === "managed_credits" &&
    invoice.billing_reason === "subscription_create"
  ) {
    // Same propagate-and-retry contract as the plan grant above. Claimed per
    // PLAN, with the same key /api/byos/deploy uses when an install takes a
    // available plan, so a plan grants its starter credits once however its first
    // managed agent arrived — and never again when the plan is reused.
    const byosGrantKey = local.id
    if (await claimEvent("byos_signup_grant", byosGrantKey)) {
      try {
        await fundWallet(
          local.userId,
          BYOS_SIGNUP_CREDITS,
          "plan_deposit",
          "BYOS signup credits",
          byosInstance.id,
          { planMode: "add" },
        )
        console.log(
          `[stripe] Granted ${BYOS_SIGNUP_CREDITS} BYOS signup credits to user ${local.userId} (invoice ${invoice.id})`,
        )
      } catch (err) {
        await releaseEvent("byos_signup_grant", byosGrantKey)
        throw err
      }
    }
  }
}

// ---------- invoice.upcoming ----------
// Stripe fires this a few days (default 3, configurable in Billing settings)
// before a subscription renews. We send a heads-up reminder via the
// notification dispatcher (in-app + email per user preferences).
//
// NOTE: the flat `invoice.subscription` field exists because src/lib/stripe.ts
// pins apiVersion "2024-06-20". Newer API versions move it under
// `invoice.parent.subscription_details` — bumping the version breaks this
// handler (and handleInvoicePaid/handleInvoicePaymentFailed above) together.

export async function handleInvoiceUpcoming(invoice: Stripe.Invoice): Promise<void> {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id
  if (!subId) return // one-off invoice, not a subscription renewal

  const local = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, subId),
    with: { plan: true, instance: true },
  })
  if (!local) return
  // Reseller subs are billed on the tenant's connected Stripe account and
  // arrive via src/lib/stripe-connect-events.ts — never remind from here.
  if (local.connectAccountId) return
  // No reminder when the subscription won't actually renew.
  if (local.cancelAtPeriodEnd || local.status === "canceled") return

  // One reminder per subscription per renewal period. The route-level
  // claimEvent("stripe", event.id) only dedups exact event redeliveries;
  // this key dedups distinct invoice.upcoming events for the same renewal.
  // Released below if nothing was delivered, so Stripe's next invoice.upcoming
  // (or a redelivery) retries rather than the reminder being lost.
  const periodKey = invoice.period_end ?? invoice.next_payment_attempt ?? 0
  const reminderKey = `${subId}:${periodKey}`
  const claimed = await claimEvent("renewal_reminder", reminderKey)
  if (!claimed) return

  // Amount comes from the invoice — plans carry no price (pricing lives in Stripe).
  const amount = (invoice.amount_due ?? invoice.total ?? 0) / 100
  const currency = (invoice.currency ?? "usd").toUpperCase()
  const amountLabel = `${currency} ${amount.toFixed(2)}`

  const renewDate =
    local.currentPeriodEnd ??
    (invoice.period_end ? new Date(invoice.period_end * 1000) : null)
  const dateLabel = renewDate
    ? renewDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "soon"

  const planName = local.plan?.name ?? "your plan"
  const result = await notify({
    userId: local.userId,
    category: "billing",
    type: "subscription_renewal_reminder",
    title: "Your subscription renews soon",
    message: `Your ${planName} subscription${local.instance ? ` for "${local.instance.name}"` : ""} renews on ${dateLabel}. ${amountLabel} will be charged to your payment method on file. No action is needed if everything looks right.`,
    url: "/dashboard/billing",
    instanceId: local.instance?.id,
    meta: {
      stripeSubscriptionId: subId,
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      periodEnd: periodKey,
    },
  })
  if (nothingDelivered(result)) {
    await releaseEvent("renewal_reminder", reminderKey)
    // Throw so the webhook route releases the event claim too and returns
    // non-2xx: Stripe redelivers, and the retry sends the reminder.
    throw new Error(`renewal reminder for ${subId} was not delivered on any channel`)
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
