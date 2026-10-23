import { NextRequest, NextResponse, after } from "next/server"
import { auth } from "@/auth"
import { db, byosServers, instances, and, eq, ne, sql } from "@/db"
import { getEffectiveTeam } from "@/lib/effective-user"
import { refreshServerWithVerdict } from "@/lib/byos-server"
import { byosPrebakeEnabled, runPrebake } from "@/lib/byos-prebake-job"
import { findLegacyServerPlan } from "@/lib/byos-plan"
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

/**
 * Re-probe a connected server and refresh its hardware snapshot. Also starts
 * the prebake when it never ran or failed (a server connected before prebake
 * was on, or one whose last attempt broke); runPrebake skips a ready or
 * running one itself.
 */
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
    const { server, verdict } = await refreshServerWithVerdict(serverId)
    if (verdict && byosPrebakeEnabled() && server?.status === "reachable") {
      after(() => runPrebake(serverId, verdict.facts))
    }
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
 * Refused while agents are installed (they are running; delete them first).
 * BYOS plans belong to agents, not servers, so they never block it — except a
 * grandfathered per-server plan that will renew, since disconnecting would
 * leave it billing for a server nobody can see. One already set to cancel at
 * period end doesn't block it.
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

    const plan = await findLegacyServerPlan(serverId)
    if (plan && !plan.cancelAtPeriodEnd) {
      return NextResponse.json(
        {
          error:
            "This server has a BYOS plan that will renew. Cancel it from Billing first, then disconnect.",
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
