import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, plans, subscriptions, and, eq } from "@/db"
import { isStripeConfigured, isDevBypassAllowed } from "@/lib/stripe"
import { getEffectiveTeam } from "@/lib/effective-user"
import { isTeamSuspended } from "@/lib/tenant"
import { logAuditEvent } from "@/lib/audit"
import { apiError } from "@/lib/api-error"
import { BRANDING } from "@/configs/branding"
import { readJsonBody } from "@/lib/request-body"
import { byosPlanCheckoutSchema } from "@/lib/validations"
import { createByosPlanCheckout } from "@/lib/byos-checkout"

/**
 * Buy one BYOS plan — the right to run one agent on a server you own.
 *
 * No server is involved: plans and servers are independent. A plan bought here
 * is available until an install takes it (POST /api/byos/deploy), and a customer can
 * hold as many as they like. Installing with no available plan buys one through its
 * own Checkout instead, so buying ahead is optional.
 *
 * The Checkout Session carries `metadata.type = "byos_plan"`;
 * handleByosPlanCheckout records the plan from that, and checkout-recovery.ts
 * records it if the webhook never arrives.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Same identity resolution as every other BYOS route: under impersonation
    // the plan is the customer's, billed to the customer's Stripe customer.
    const ctx = await getEffectiveTeam()
    if (!ctx) return NextResponse.json({ error: "No active team" }, { status: 403 })
    const { effectiveUserId, actorUserId, teamId } = ctx

    const body = await readJsonBody(req, byosPlanCheckoutSchema, { allowEmpty: true })
    if (!body.ok) return body.res
    const interval: "month" | "year" = body.data.interval ?? "month"

    if (await isTeamSuspended(teamId)) {
      return NextResponse.json(
        { error: "This account is suspended. Contact your administrator." },
        { status: 403 },
      )
    }

    const dbPlan = await db.query.plans.findFirst({
      where: and(eq(plans.tier, "byos"), eq(plans.isActive, true)),
    })
    if (!dbPlan) {
      return NextResponse.json({ error: "BYOS plan is not configured" }, { status: 500 })
    }

    await logAuditEvent({
      userId: actorUserId,
      onBehalfOfUserId: actorUserId !== effectiveUserId ? effectiveUserId : undefined,
      teamId,
      action: "billing.subscription.create",
      targetType: "subscription",
      targetLabel: "BYOS plan",
      meta: { plan: "byos", interval },
    })

    // ── Paid: Stripe Checkout ───────────────────────────────────────
    if (isStripeConfigured()) {
      const checkoutUrl = await createByosPlanCheckout({
        userId: effectiveUserId,
        interval,
        successUrl: `${BRANDING.appUrl}/dashboard/byos?plan=bought`,
        cancelUrl: `${BRANDING.appUrl}/dashboard/byos`,
      })
      return NextResponse.json({ checkoutUrl })
    }

    // Never grant a plan for free outside development.
    if (!isDevBypassAllowed()) {
      return NextResponse.json(
        { error: "Payments are temporarily unavailable. You have not been charged." },
        { status: 503 },
      )
    }

    // ── Dev mode: no Stripe, record an available plan directly ──────
    await db.insert(subscriptions).values({
      userId: effectiveUserId,
      planId: dbPlan.id,
      interval,
      status: "active",
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError("byos/plans:buy", err)
  }
}
