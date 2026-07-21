import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, and, desc, tenantPlans } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantConfig } from "@/lib/tenant"
import { createTenantPrice } from "@/lib/stripe-connect"
import { logAuditEvent } from "@/lib/audit"

// GET — the tenant's plan catalog (active + archived).
export async function GET() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const plans = await db.query.tenantPlans.findMany({
    where: eq(tenantPlans.teamId, admin.tenantTeamId),
    orderBy: desc(tenantPlans.createdAt),
  })
  return NextResponse.json({ plans })
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  amountCents: z.number().int().positive(),
  interval: z.enum(["month", "year"]),
  agentLimit: z.number().int().positive().optional(),
  seatLimit: z.number().int().positive().optional(),
})

// POST — create a plan: mints a Stripe Price on the tenant's connected account,
// then stores the catalog row. Requires the connected account to exist.
export async function POST(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const { name, amountCents, interval, agentLimit, seatLimit } = parsed.data

  const cfg = await getTenantConfig(admin.tenantTeamId)
  if (!cfg?.stripeConnectAccountId) {
    return NextResponse.json(
      { error: "Connect your Stripe account first (Branding & Settings)." },
      { status: 409 },
    )
  }

  let stripePriceId: string
  try {
    stripePriceId = await createTenantPrice({
      connectAccountId: cfg.stripeConnectAccountId,
      name,
      amountCents,
      interval,
    })
  } catch (err) {
    console.error("[tenant.plan.create] Stripe price creation failed:", err)
    return NextResponse.json({ error: "Could not create the price on your Stripe account." }, { status: 502 })
  }

  const [plan] = await db
    .insert(tenantPlans)
    .values({
      teamId: admin.tenantTeamId,
      stripePriceId,
      name,
      priceCents: amountCents,
      interval,
      agentLimit: agentLimit ?? null,
      seatLimit: seatLimit ?? null,
    })
    .returning()

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.plan.create",
    teamId: admin.tenantTeamId,
    targetType: "tenant_plan",
    targetId: plan.id,
    targetLabel: name,
    meta: { amountCents, interval },
  })

  return NextResponse.json({ id: plan.id }, { status: 201 })
}

const archiveSchema = z.object({ planId: z.string().min(1) })

// PATCH — archive (deactivate) a plan so it's no longer offered at checkout.
export async function PATCH(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const body = await req.json().catch(() => null)
  const parsed = archiveSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const result = await db
    .update(tenantPlans)
    .set({ active: false })
    .where(and(eq(tenantPlans.id, parsed.data.planId), eq(tenantPlans.teamId, admin.tenantTeamId)))
    .returning({ id: tenantPlans.id })
  if (result.length === 0) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.plan.archive",
    teamId: admin.tenantTeamId,
    targetType: "tenant_plan",
    targetId: parsed.data.planId,
  })
  return NextResponse.json({ ok: true })
}
