import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, and, inArray, memberships } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { listChildTeams } from "@/lib/tenant"
import { startImpersonation } from "@/lib/impersonation"
import { logAuditEvent } from "@/lib/audit"

const schema = z.object({ userId: z.string().min(1) })

// POST — impersonate one of this tenant's end-customer users (for support).
// Scope: the target must be a member of a child team under this tenant.
export async function POST(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const targetUserId = parsed.data.userId

  if (targetUserId === admin.userId) {
    return NextResponse.json({ error: "Cannot impersonate yourself" }, { status: 400 })
  }

  const childIds = (await listChildTeams(admin.tenantTeamId)).map((c) => c.id)
  if (childIds.length === 0) {
    return NextResponse.json({ error: "Not in your customers" }, { status: 403 })
  }

  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, targetUserId), inArray(memberships.teamId, childIds)),
    columns: { teamId: true },
  })
  if (!membership) {
    return NextResponse.json({ error: "Not one of your customers" }, { status: 403 })
  }

  await startImpersonation(targetUserId)
  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.impersonate",
    teamId: admin.tenantTeamId,
    targetType: "user",
    targetId: targetUserId,
  })
  return NextResponse.json({ ok: true })
}
