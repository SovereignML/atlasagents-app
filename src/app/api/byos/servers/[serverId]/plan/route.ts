import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, byosServers, plans, subscriptions, users, and, eq } from "@/db"
import { stripe, isStripeConfigured, isDevBypassAllowed } from "@/lib/stripe"
import { getEffectiveTeam } from "@/lib/effective-user"
import { isTeamSuspended } from "@/lib/tenant"
import { findByosPlan } from "@/lib/byos-plan"
import { logAuditEvent } from "@/lib/audit"
import { apiError } from "@/lib/api-error"
import { planUnitAmountCents } from "@/lib/pricing"
import { findPlanBySlug } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import { readJsonBody } from "@/lib/request-body"
import { byosPlanCheckoutSchema } from "@/lib/validations"
import { stripeIdempotencyKey, windowKey } from "@/lib/stripe-idempotency"

/**
 * Buy a BYOS plan for one connected server.
 *
 * This is the only paid step in BYOS. Connecting a server is free, and
 * installing agents onto it (POST /api/byos/deploy) never opens a checkout —
 * it only requires that the server has a plan. One plan covers every agent on
 * its server.
 *
 * The Checkout Session carries `metadata.type = "byos_plan"` and the server id;
 * handleCheckoutSessionCompleted records the plan from that, and
 * checkout-recovery.ts records it if the webhook never arrives.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
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

    const { serverId } = await params
    const server = await db.query.byosServers.findFirst({
      where: and(eq(byosServers.id, serverId), eq(byosServers.teamId, teamId)),
    })
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 })

    const body = await readJsonBody(req, byosPlanCheckoutSchema, { allowEmpty: true })
    if (!body.ok) return body.res
    const interval: "month" | "year" = body.data.interval ?? "month"

    if (await isTeamSuspended(teamId)) {
      return NextResponse.json(
        { error: "This account is suspended. Contact your administrator." },
        { status: 403 },
      )
    }

    const existing = await findByosPlan(server.id)
    if (existing) {
      return NextResponse.json(
        { error: "This server already has a BYOS plan." },
        { status: 409 },
      )
    }

    const planConfig = findPlanBySlug("byos")
    const dbPlan = await db.query.plans.findFirst({
      where: and(eq(plans.tier, "byos"), eq(plans.isActive, true)),
    })
    if (!planConfig || !dbPlan) {
      return NextResponse.json({ error: "BYOS plan is not configured" }, { status: 500 })
    }

    await logAuditEvent({
      userId: actorUserId,
      onBehalfOfUserId: actorUserId !== effectiveUserId ? effectiveUserId : undefined,
      teamId,
      action: "billing.subscription.create",
      targetType: "byos_server",
      targetId: server.id,
      targetLabel: server.label,
      meta: { plan: "byos", interval, byosHost: server.host },
    })

    // ── Paid: Stripe Checkout ───────────────────────────────────────
    if (isStripeConfigured()) {
      const userRow = await db.query.users.findFirst({
        where: eq(users.id, effectiveUserId),
        columns: { stripeCustomerId: true, email: true },
      })
      let stripeCustomerId = userRow?.stripeCustomerId
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create(
          {
            // The OWNER's email — under impersonation session.user.email is the
            // admin's, and would stamp staff details onto the customer's record.
            email: userRow?.email ?? undefined,
            metadata: { userId: effectiveUserId },
          },
          { idempotencyKey: stripeIdempotencyKey("customer", effectiveUserId, userRow?.email) },
        )
        stripeCustomerId = customer.id
        await db.update(users).set({ stripeCustomerId }).where(eq(users.id, effectiveUserId))
      }

      const metadata = {
        type: "byos_plan",
        byosServerId: server.id,
        userId: effectiveUserId,
        planSlug: "byos",
        interval,
      }
      const checkout = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        allow_promotion_codes: true,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${BRANDING.name} Bring Your Own Server`,
                description: `Management plan for ${server.label} · install as many agents as it holds`,
              },
              unit_amount: planUnitAmountCents(planConfig, interval),
              recurring: { interval },
            },
            quantity: 1,
          },
        ],
        metadata,
        // Also on the subscription, so it is identifiable from Stripe's side
        // without going through the session.
        subscription_data: { metadata },
        // Straight on to installing — the reason they bought it.
        success_url: `${BRANDING.appUrl}/dashboard/byos/deploy?serverId=${server.id}`,
        cancel_url: `${BRANDING.appUrl}/dashboard/byos`,
      }, {
        idempotencyKey: stripeIdempotencyKey("byos-plan", server.id, stripeCustomerId, interval, windowKey()),
      })
      return NextResponse.json({ checkoutUrl: checkout.url })
    }

    // Never grant a plan for free outside development.
    if (!isDevBypassAllowed()) {
      return NextResponse.json(
        { error: "Payments are temporarily unavailable. You have not been charged." },
        { status: 503 },
      )
    }

    // ── Dev mode: no Stripe, record the plan directly ───────────────
    await db.insert(subscriptions).values({
      userId: effectiveUserId,
      planId: dbPlan.id,
      byosServerId: server.id,
      interval,
      status: "active",
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError("byos/servers:plan", err)
  }
}
