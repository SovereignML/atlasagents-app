import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, memberships, teams, eq } from "@/db"
import {
  getInstanceAccessLevel,
  listInstanceAccess,
  setInstanceAccess,
  isAccessLevel,
} from "@/lib/instance-access"

/**
 * GET /api/instances/[instanceId]/access
 *
 * Lists the per-agent access grants plus the team members who can be granted
 * access (for the picker). Manager-level only (creator / team-owner / a
 * manager grant), matching who can see the Access tab.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { instanceId } = await params

  const access = await getInstanceAccessLevel(session.user.id, instanceId)
  if (!access.teamId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  }
  if (!access.isOwnerLike && access.level !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { userId: true },
  })

  const grants = await listInstanceAccess(instanceId)

  // Team members who could receive a grant (the creator and team owner always
  // have implicit access, so they're excluded from the picker).
  const memberRows = await db.query.memberships.findMany({
    where: eq(memberships.teamId, access.teamId),
    with: { user: { columns: { id: true, name: true, email: true } } },
  })
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, access.teamId),
    columns: { ownerId: true },
  })
  const members = memberRows
    .filter((m) => m.userId !== inst?.userId && m.userId !== team?.ownerId)
    .map((m) => ({
      userId: m.userId,
      name: m.user?.name ?? null,
      email: m.user?.email ?? "",
      teamRole: m.role,
    }))

  return NextResponse.json({ grants, members, canManage: true })
}

/**
 * POST /api/instances/[instanceId]/access
 * Body: { userId: string, level: "viewer" | "operator" | "manager" }
 *
 * Grant (or change) a member's access. Manager-level actors only; only
 * owner-like actors may mint `manager` grants.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { instanceId } = await params
  const body = (await req.json().catch(() => ({}))) as { userId?: string; level?: string }
  if (!body.userId || !isAccessLevel(body.level)) {
    return NextResponse.json({ error: "Missing userId or invalid level" }, { status: 400 })
  }

  const result = await setInstanceAccess({
    instanceId,
    granteeUserId: body.userId,
    level: body.level,
    actorUserId: session.user.id,
    mode: "grant",
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true })
}
