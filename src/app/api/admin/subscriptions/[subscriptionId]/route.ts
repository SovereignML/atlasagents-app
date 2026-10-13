import { NextResponse } from "next/server"
import type Stripe from "stripe"

import { requireAdmin } from "@/lib/admin-guard"
import { apiError } from "@/lib/api-error"
import { logAuditEvent } from "@/lib/audit"
import { db, eq, subscriptions } from "@/db"
import { readJsonBody } from "@/lib/request-body"
import { isStripeConfigured, stripe } from "@/lib/stripe"
import { stripeIdempotencyKey } from "@/lib/stripe-idempotency"
import { adminSubscriptionChangeSchema } from "@/lib/validations"

/**
 * Admin changes to a subscription.
 *
 * A subscription that Stripe bills is changed IN STRIPE, and our row follows
 * Stripe's answer (the customer.subscription.* webhooks write the same
 * fields). Editing only our row, as this route used to, told the dashboard a
 * subscription was canceled while Stripe kept charging the card, or marked one
 * active that nobody was paying for.
 *
 * Reseller subscriptions live on the tenant's connected Stripe account and are
 * the tenant's to change, so they are refused here. Rows with no Stripe
 * subscription (dev, manual grants) can have their status set directly.
 * Every change is audited.
 */

const TERMINAL = new Set(["canceled", "incomplete_expired"])

function rowFields(sub: Stripe.Subscription) {
  return {
    status: sub.status,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const parsed = await readJsonBody(request, adminSubscriptionChangeSchema)
  if (!parsed.ok) return parsed.res
  const change = parsed.data

  const { subscriptionId } = await params
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  })
  if (!existing) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
  }
  if (existing.connectAccountId) {
    return NextResponse.json(
      { error: "This subscription is billed on a reseller's Stripe account. The reseller manages it." },
      { status: 409 },
    )
  }

  const audit = (action: Parameters<typeof logAuditEvent>[0]["action"], meta: Record<string, unknown>) =>
    logAuditEvent({
      userId: guard.userId,
      action,
      targetType: "subscription",
      targetId: existing.id,
      onBehalfOfUserId: existing.userId,
      meta: { stripeSubscriptionId: existing.stripeSubscriptionId, before: existing.status, ...meta },
    })

  try {
    // ── No Stripe subscription: a local record, set directly ──
    if (!existing.stripeSubscriptionId) {
      if (change.action !== "set_status") {
        return NextResponse.json(
          { error: "This subscription has no Stripe subscription. Use set_status." },
          { status: 400 },
        )
      }
      const [updated] = await db
        .update(subscriptions)
        .set({ status: change.status })
        .where(eq(subscriptions.id, existing.id))
        .returning()
      await audit("admin.subscription.set_status", { after: change.status })
      return NextResponse.json(updated)
    }

    // ── Stripe-backed: change it in Stripe ──
    if (change.action === "set_status") {
      return NextResponse.json(
        { error: "Stripe bills this subscription; its status follows Stripe. Cancel or resume it instead." },
        { status: 400 },
      )
    }
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe is not configured on this server." }, { status: 503 })
    }
    if (TERMINAL.has(existing.status) && change.action !== "cancel") {
      return NextResponse.json(
        { error: `The subscription is ${existing.status}; it can't be changed.` },
        { status: 409 },
      )
    }

    const stripeId = existing.stripeSubscriptionId
    let sub: Stripe.Subscription
    if (change.action === "cancel") {
      sub = await stripe.subscriptions.cancel(stripeId, undefined, {
        idempotencyKey: stripeIdempotencyKey("cancel-subscription", stripeId),
      })
    } else {
      const cancelAtPeriodEnd = change.action === "cancel_at_period_end"
      sub = await stripe.subscriptions.update(
        stripeId,
        { cancel_at_period_end: cancelAtPeriodEnd },
        {
          idempotencyKey: stripeIdempotencyKey(
            "subscription-cancel-at-period-end",
            stripeId,
            String(cancelAtPeriodEnd),
            existing.cancelAtPeriodEnd ? "was-set" : "was-clear",
          ),
        },
      )
    }

    const [updated] = await db
      .update(subscriptions)
      .set(rowFields(sub))
      .where(eq(subscriptions.id, existing.id))
      .returning()
    await audit(
      change.action === "cancel"
        ? "admin.subscription.cancel"
        : change.action === "resume"
          ? "admin.subscription.resume"
          : "admin.subscription.cancel_at_period_end",
      { after: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end },
    )
    return NextResponse.json(updated)
  } catch (err) {
    return apiError(`admin/subscriptions ${subscriptionId}`, err, "Failed to update subscription.")
  }
}

/**
 * Delete a subscription RECORD. Refused while Stripe may still bill it:
 * cancel it first, so deleting our row never leaves a live Stripe
 * subscription with nothing on our side to show for it.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const { subscriptionId } = await params
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  })
  if (!existing) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
  }
  if (existing.stripeSubscriptionId && !TERMINAL.has(existing.status)) {
    return NextResponse.json(
      { error: "Stripe may still bill this subscription. Cancel it before deleting the record." },
      { status: 409 },
    )
  }

  try {
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId))
    await logAuditEvent({
      userId: guard.userId,
      action: "admin.subscription.delete",
      targetType: "subscription",
      targetId: existing.id,
      onBehalfOfUserId: existing.userId,
      meta: { stripeSubscriptionId: existing.stripeSubscriptionId, status: existing.status },
    })
    return NextResponse.json({ message: "Subscription deleted" })
  } catch (err) {
    return apiError(`admin/subscriptions delete ${subscriptionId}`, err, "Failed to delete subscription.")
  }
}
