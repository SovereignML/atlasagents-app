import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, byosServers, instances, and, eq, ne, sql } from "@/db"
import { getEffectiveTeam } from "@/lib/effective-user"
import { refreshServer } from "@/lib/byos-server"
import { apiError } from "@/lib/api-error"

/**
 * Load a server, scoped to the EFFECTIVE team — so an admin impersonating a
 * customer can refresh and disconnect that customer's servers, matching the
 * BYOS pages and the connect/install routes. Team scoping is what stops one
 * customer reaching another's machine; impersonation only changes which team
 * the caller is acting inside, and is itself re-authorized per request by
 * getHonoredImpersonatedUserId().
 */
async function loadOwned(serverId: string) {
  const ctx = await getEffectiveTeam()
  if (!ctx) return null
  return db.query.byosServers.findFirst({
    where: and(eq(byosServers.id, serverId), eq(byosServers.teamId, ctx.teamId)),
  })
}

/** Re-probe a connected server and refresh its hardware snapshot. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { serverId } = await params
  const owned = await loadOwned(serverId)
  if (!owned) return NextResponse.json({ error: "Server not found" }, { status: 404 })

  try {
    const server = await refreshServer(serverId)
    return NextResponse.json({ server })
  } catch (err) {
    return apiError("byos/servers:refresh", err)
  }
}

/**
 * Disconnect a server: forget it on our side. Nothing is uninstalled and
 * nothing on the machine is touched — it is the customer's hardware, and
 * "disconnect" means we stop managing it, not that we go and delete things.
 *
 * Refused while agents are installed, because those are billed and running;
 * the agent has to be deleted first.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { serverId } = await params
  const owned = await loadOwned(serverId)
  if (!owned) return NextResponse.json({ error: "Server not found" }, { status: 404 })

  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(instances)
      .where(and(eq(instances.byosServerId, serverId), ne(instances.status, "deleted")))

    if (count > 0) {
      return NextResponse.json(
        {
          error: `This server still has ${count} agent${count === 1 ? "" : "s"} on it. Delete ${
            count === 1 ? "it" : "them"
          } first.`,
        },
        { status: 409 },
      )
    }

    await db.delete(byosServers).where(eq(byosServers.id, serverId))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError("byos/servers:disconnect", err)
  }
}
