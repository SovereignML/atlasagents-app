import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { setInstanceAccess, revokeInstanceAccess, isAccessLevel } from "@/lib/instance-access"

/**
 * PATCH /api/instances/[instanceId]/access/[userId]
 * Body: { level: "viewer" | "operator" | "manager" }
 *
 * Change an existing grantee's access level.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string; userId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const { instanceId, userId } = await params
  const body = (await req.json().catch(() => ({}))) as { level?: string }
  if (!isAccessLevel(body.level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 })
  }

  const result = await setInstanceAccess({
    instanceId,
    granteeUserId: userId,
    level: body.level,
    actorUserId: effectiveUserId,
    mode: "update",
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true })
}

/**
 * DELETE /api/instances/[instanceId]/access/[userId]
 *
 * Revoke a member's access to the agent.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string; userId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const { instanceId, userId } = await params

  const result = await revokeInstanceAccess({
    instanceId,
    granteeUserId: userId,
    actorUserId: effectiveUserId,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true })
}
