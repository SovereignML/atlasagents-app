import { NextResponse } from "next/server"
import { z } from "zod"
import { requireTenantAdminOverChild, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTeam } from "@/lib/tenant"
import { startActAsTeam } from "@/lib/impersonation"
import { logAuditEvent } from "@/lib/audit"

const schema = z.object({ childTeamId: z.string().min(1) })

// POST — "act as customer": drop into a child end-customer team's full dashboard
// (deploy, instances, billing…). Scope: the team must be a direct child of this
// tenant (requireTenantAdminOverChild). The act-as cookie pins the child team +
// its owner; honor is re-checked on every request (see effective-user.ts), and
// audit records the real tenant admin as the actor.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const { childTeamId } = parsed.data

  const admin = await requireTenantAdminOverChild(childTeamId)
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const child = await getTeam(childTeamId)
  if (!child) return NextResponse.json({ error: "Team not found" }, { status: 404 })

  await startActAsTeam({ childTeamId, childOwnerUserId: child.ownerId })
  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.act_as.start",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: childTeamId,
    targetLabel: child.name,
    onBehalfOfUserId: child.ownerId,
  })
  return NextResponse.json({ ok: true })
}
