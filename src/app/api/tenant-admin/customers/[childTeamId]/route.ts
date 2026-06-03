import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, teams } from "@/db"
import { requireTenantAdminOverChild, isTenantGuardError } from "@/lib/tenant-admin-access"
import { logAuditEvent } from "@/lib/audit"

const patchSchema = z.object({
  suspended: z.boolean().optional(),
  agentLimit: z.number().int().positive().nullable().optional(),
  seatLimit: z.number().int().positive().optional(),
  name: z.string().min(1).max(120).optional(),
})

// PATCH — suspend/unsuspend a child end-customer, or update its name/limits.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ childTeamId: string }> },
) {
  const { childTeamId } = await params
  const admin = await requireTenantAdminOverChild(childTeamId)
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  const { suspended, agentLimit, seatLimit, name } = parsed.data

  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (suspended !== undefined) set.suspendedAt = suspended ? new Date() : null
  if (agentLimit !== undefined) set.agentLimit = agentLimit
  if (seatLimit !== undefined) set.seatLimit = seatLimit
  if (name !== undefined) set.name = name

  await db.update(teams).set(set).where(eq(teams.id, childTeamId))

  await logAuditEvent({
    userId: admin.userId,
    action: suspended !== undefined ? "tenant.customer.suspend" : "tenant.customer.update",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: childTeamId,
    meta: { suspended, agentLimit, seatLimit, name },
  })

  return NextResponse.json({ ok: true })
}
