import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, and, inArray, sql, users, memberships, instances, notInArray } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { createChildTeam, getTenantConfig, listChildTeams } from "@/lib/tenant"
import { logAuditEvent } from "@/lib/audit"

// GET — list this tenant's end-customer (child) teams with agent + member counts.
export async function GET() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const children = await listChildTeams(admin.tenantTeamId)
  const ids = children.map((c) => c.id)

  // Per-team counts (only when there are children, to skip empty IN ()).
  const agentCounts = new Map<string, number>()
  const memberCounts = new Map<string, number>()
  if (ids.length) {
    const agentRows = await db
      .select({ teamId: instances.teamId, count: sql<number>`count(*)` })
      .from(instances)
      .where(and(inArray(instances.teamId, ids), notInArray(instances.status, ["deleted"])))
      .groupBy(instances.teamId)
    for (const r of agentRows) agentCounts.set(r.teamId, Number(r.count))

    const memberRows = await db
      .select({ teamId: memberships.teamId, count: sql<number>`count(*)` })
      .from(memberships)
      .where(inArray(memberships.teamId, ids))
      .groupBy(memberships.teamId)
    for (const r of memberRows) memberCounts.set(r.teamId, Number(r.count))
  }

  return NextResponse.json({
    customers: children.map((c) => ({
      id: c.id,
      name: c.name,
      suspended: c.suspendedAt != null,
      agentLimit: c.agentLimit,
      seatLimit: c.seatLimit,
      agents: agentCounts.get(c.id) ?? 0,
      members: memberCounts.get(c.id) ?? 0,
      createdAt: c.createdAt.toISOString(),
    })),
  })
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  ownerEmail: z.string().email(),
  agentLimit: z.number().int().positive().optional(),
  seatLimit: z.number().int().positive().optional(),
})

// POST — create a child end-customer team owned by an existing user (by email).
// New users self-serve via signup on the tenant's domain (open registration),
// so this path requires the owner to already have an account.
export async function POST(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  const { name, ownerEmail, agentLimit, seatLimit } = parsed.data

  const owner = await db.query.users.findFirst({
    where: eq(users.email, ownerEmail),
    columns: { id: true },
  })
  if (!owner) {
    return NextResponse.json(
      { error: "No account with that email. Ask them to sign up on your domain first." },
      { status: 400 },
    )
  }

  const cfg = await getTenantConfig(admin.tenantTeamId)
  const child = await createChildTeam({
    parentTeamId: admin.tenantTeamId,
    name,
    ownerUserId: owner.id,
    agentLimit: agentLimit ?? cfg?.defaultChildAgentLimit,
    seatLimit: seatLimit ?? cfg?.defaultChildSeatLimit,
  })

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.customer.create",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: child.id,
    targetLabel: name,
  })

  return NextResponse.json({ id: child.id }, { status: 201 })
}
