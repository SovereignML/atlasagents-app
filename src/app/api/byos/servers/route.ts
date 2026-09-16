import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserTeam } from "@/lib/team"
import { isTeamSuspended } from "@/lib/tenant"
import { BlockedHostError } from "@/lib/net-guard"
import {
  connectServer,
  listServersForTeam,
  ByosConnectError,
  MAX_IDLE_SERVERS_PER_TEAM,
} from "@/lib/byos-server"
import { apiError } from "@/lib/api-error"

/**
 * Connect a server the customer already owns.
 *
 * FREE, and deliberately so: no Stripe, no instance row, nothing installed on
 * the machine. We SSH in with the fleet key, read the hardware, and decide
 * whether an agent could run there. Charging happens later, when they install
 * one. This route works even when Stripe is not configured at all.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const team = await getUserTeam(session.user.id)
  if (!team) return NextResponse.json({ error: "No active team" }, { status: 403 })
  if (await isTeamSuspended(team.teamId)) {
    return NextResponse.json(
      { error: "This account is suspended. Contact your administrator." },
      { status: 403 },
    )
  }

  let body: { host?: string; port?: number; sshUser?: string; label?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    const { server, verdict } = await connectServer({
      teamId: team.teamId,
      userId: session.user.id,
      host: String(body.host ?? ""),
      port: body.port,
      sshUser: body.sshUser,
      label: body.label,
    })
    // Conflicts are returned alongside a successful connect: they describe what
    // installing an agent would disturb, which the user decides about at
    // install time, not now.
    return NextResponse.json({ server, conflicts: verdict.conflicts })
  } catch (err) {
    if (err instanceof ByosConnectError) {
      return NextResponse.json(
        {
          error: err.message,
          blockers: err.verdict?.blockers ?? [],
          conflicts: err.verdict?.conflicts ?? [],
        },
        { status: err.status },
      )
    }
    if (err instanceof BlockedHostError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return apiError("byos/servers:connect", err)
  }
}

/** Servers this team has connected, with the agent count on each. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const team = await getUserTeam(session.user.id)
  if (!team) return NextResponse.json({ error: "No active team" }, { status: 403 })

  try {
    const servers = await listServersForTeam(team.teamId)
    return NextResponse.json({
      servers,
      idleLimit: MAX_IDLE_SERVERS_PER_TEAM,
      idleUsed: servers.filter((s) => s.agentCount === 0).length,
    })
  } catch (err) {
    return apiError("byos/servers:list", err)
  }
}
