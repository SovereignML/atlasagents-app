import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  db,
  eq,
  and,
  inArray,
  sql,
  users,
  memberships,
  instances,
  verificationTokens,
  notInArray,
} from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { createChildTeam, getTenantConfig, listChildTeams } from "@/lib/tenant"
import { hashPassword } from "@/lib/password"
import { sendPasswordResetEmail } from "@/lib/email"
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
  ownerName: z.string().min(1).max(120).optional(),
  ownerEmail: z.string().email(),
  agentLimit: z.number().int().positive().optional(),
  seatLimit: z.number().int().positive().optional(),
})

// POST — create a child end-customer team with a FRESH owner account.
//
// SECURITY: this endpoint provisions a brand-new user for the owner email and
// never attaches an EXISTING account. Attaching an existing arbitrary user would
// grant the tenant admin impersonation over that user (impersonation scope is
// derived from child-team membership — see effective-user.ts / isUserInTenantScopeOf),
// i.e. a cross-account takeover. Existing users must instead self-serve via
// signup on the tenant's domain (open registration attaches them consensually).
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
  const { name, ownerName, agentLimit, seatLimit } = parsed.data
  const ownerEmail = parsed.data.ownerEmail.toLowerCase()

  const existing = await db.query.users.findFirst({
    where: eq(users.email, ownerEmail),
    columns: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      {
        error:
          "An account with that email already exists. Have them sign up on your domain to be added — existing accounts can't be claimed.",
      },
      { status: 409 },
    )
  }

  // Fresh owner account. A random password makes it login-only via the
  // set-password invite below (or the standard "forgot password" flow); the
  // tenant admin never learns or sets the customer's password.
  const [owner] = await db
    .insert(users)
    .values({
      name: ownerName ?? name,
      email: ownerEmail,
      hashedPassword: await hashPassword(crypto.randomBytes(24).toString("hex")),
    })
    .returning({ id: users.id })
  if (!owner) {
    return NextResponse.json({ error: "Failed to create owner account" }, { status: 500 })
  }

  const cfg = await getTenantConfig(admin.tenantTeamId)
  const child = await createChildTeam({
    parentTeamId: admin.tenantTeamId,
    name,
    ownerUserId: owner.id,
    agentLimit: agentLimit ?? cfg?.defaultChildAgentLimit,
    seatLimit: seatLimit ?? cfg?.defaultChildSeatLimit,
  })
  await db.update(users).set({ activeTeamId: child.id }).where(eq(users.id, owner.id))

  // Set-password invite: reuse the password-reset token flow so the new owner
  // can pick their own password and log in. Best-effort — never fail creation
  // over email delivery (the tenant can resend, or the owner uses forgot-password).
  try {
    await db.delete(verificationTokens).where(eq(verificationTokens.identifier, ownerEmail))
    const token = crypto.randomBytes(32).toString("hex")
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex")
    await db.insert(verificationTokens).values({
      identifier: ownerEmail,
      token: hashedToken,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    await sendPasswordResetEmail(ownerEmail, token)
  } catch (err) {
    console.error("[tenant.customer.create] invite email failed:", err)
  }

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.customer.create",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: child.id,
    targetLabel: name,
    meta: { ownerEmail },
  })

  return NextResponse.json({ id: child.id }, { status: 201 })
}
