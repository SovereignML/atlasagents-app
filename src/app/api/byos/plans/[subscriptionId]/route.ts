import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, plans, subscriptions, eq } from "@/db"
import { isStripeConfigured, stripe } from "@/lib/stripe"
import { stripeIdempotencyKey } from "@/lib/stripe-idempotency"
import { getEffectiveTeam } from "@/lib/effective-user"
import { logAuditEvent } from "@/lib/audit"
import { apiError } from "@/lib/api-error"
import { readJsonBody } from "@/lib/request-body"
import { byosPlanChangeSchema } from "@/lib/validations"
import { planIsLive } from "@/lib/byos-install"
import { stopUncoveredByosAgents } from "@/lib/byos-plan"

/**
 * Cancel one of your BYOS plans, or undo a cancel.
 *
 * A cancel takes effect at the END of the paid period: the plan's agent keeps
 * running through what was paid for, and customer.subscription.deleted stops it
 * then. Undoing it before then keeps the plan renewing. The change is made IN
 * STRIPE and our row follows Stripe's answer, as the admin route does. The
 * Billing portal does the same thing; this is the in-app way.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { subscriptionId } = await params
  try {
    const ctx = await getEffectiveTeam()
    if (!ctx) return NextResponse.json({ error: "No active team" }, { status: 403 })
    const { effectiveUserId, actorUserId, teamId } = ctx

    const body = await readJsonBody(req, byosPlanChangeSchema)
    if (!body.ok) return body.res
    const { cancelAtPeriodEnd } = body.data

    // Owner-scoped, and BYOS plans only: this route must not become a way to
    // cancel a managed-VPS subscription.
    const existing = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    })
    const plan = existing?.planId
      ? await db.query.plans.findFirst({ where: eq(plans.id, existing.planId), columns: { tier: true } })
      : null
    if (!existing || existing.userId !== effectiveUserId || plan?.tier !== "byos") {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 })
    }
    if (!planIsLive(existing.status)) {
      return NextResponse.json(
        { error: `This plan is ${existing.status}; it can't be changed.` },
        { status: 409 },
      )
    }

    const audit = () =>
      logAuditEvent({
        userId: actorUserId,
        onBehalfOfUserId: actorUserId !== effectiveUserId ? effectiveUserId : undefined,
        teamId,
        action: "billing.subscription.cancel",
        targetType: "subscription",
        targetId: existing.id,
        targetLabel: "BYOS plan",
        meta: { plan: "byos", cancelAtPeriodEnd, stripeSubscriptionId: existing.stripeSubscriptionId },
      })

    // ── No Stripe subscription (dev): there is no period to run out ──
    if (!existing.stripeSubscriptionId) {
      if (!cancelAtPeriodEnd) {
        return NextResponse.json({ error: "This plan has no billing period to resume." }, { status: 400 })
      }
      await db.update(subscriptions).set({ status: "canceled" }).where(eq(subscriptions.id, existing.id))
      if (existing.instanceId) await stopUncoveredByosAgents([existing.instanceId])
      await audit()
      return NextResponse.json({ status: "canceled", cancelAtPeriodEnd: false })
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe is not configured on this server." }, { status: 503 })
    }

    const stripeId = existing.stripeSubscriptionId
    const sub = await stripe.subscriptions.update(
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
    const fields = {
      status: sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }
    await db.update(subscriptions).set(fields).where(eq(subscriptions.id, existing.id))
    await audit()
    return NextResponse.json(fields)
  } catch (err) {
    return apiError(`byos/plans ${subscriptionId}`, err, "Failed to update the plan.")
  }
}
