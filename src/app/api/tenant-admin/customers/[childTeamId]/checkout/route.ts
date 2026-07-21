import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, and, users, teamBranding, tenantPlans } from "@/db"
import { requireTenantAdminOverChild, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTeam, getTenantConfig } from "@/lib/tenant"
import { createConnectedCheckout } from "@/lib/stripe-connect"
import { BRANDING } from "@/configs/branding"
import { logAuditEvent } from "@/lib/audit"

const schema = z.object({ tenantPlanId: z.string().min(1) })

// POST — create a Connect checkout link for a child end-customer to subscribe to
// one of the tenant's plans (paid to the tenant's own Stripe, no platform fee).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ childTeamId: string }> },
) {
  const { childTeamId } = await params
  const admin = await requireTenantAdminOverChild(childTeamId)
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const cfg = await getTenantConfig(admin.tenantTeamId)
  if (!cfg?.stripeConnectAccountId) {
    return NextResponse.json({ error: "Connect your Stripe account first." }, { status: 409 })
  }
  // Never send a customer to checkout on an account that can't take payments yet.
  if (!cfg.stripeConnectChargesEnabled) {
    return NextResponse.json(
      { error: "Your Stripe account can't accept payments yet — finish onboarding." },
      { status: 409 },
    )
  }

  const plan = await db.query.tenantPlans.findFirst({
    where: and(
      eq(tenantPlans.id, parsed.data.tenantPlanId),
      eq(tenantPlans.teamId, admin.tenantTeamId),
      eq(tenantPlans.active, true),
    ),
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  const child = await getTeam(childTeamId)
  if (!child) return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  const owner = await db.query.users.findFirst({
    where: eq(users.id, child.ownerId),
    columns: { email: true },
  })
  if (!owner?.email) return NextResponse.json({ error: "Customer has no email" }, { status: 400 })

  // Return URLs on the tenant's own verified custom domain when available, so the
  // customer stays inside the white-label experience; else the platform host.
  const branding = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, admin.tenantTeamId),
    columns: { customDomain: true, domainVerifiedAt: true },
  })
  const base =
    branding?.customDomain && branding.domainVerifiedAt
      ? `https://${branding.customDomain}`
      : BRANDING.appUrl

  let url: string | null
  try {
    const res = await createConnectedCheckout({
      connectAccountId: cfg.stripeConnectAccountId,
      priceId: plan.stripePriceId,
      customerEmail: owner.email,
      childTeamId,
      tenantPlanId: plan.id,
      successUrl: `${base}/dashboard`,
      cancelUrl: `${base}/dashboard/billing`,
    })
    url = res.url
  } catch (err) {
    console.error("[tenant.checkout.create] Stripe checkout failed:", err)
    return NextResponse.json({ error: "Could not start checkout." }, { status: 502 })
  }

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.checkout.create",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: childTeamId,
    meta: { tenantPlanId: plan.id },
  })

  return NextResponse.json({ url })
}
