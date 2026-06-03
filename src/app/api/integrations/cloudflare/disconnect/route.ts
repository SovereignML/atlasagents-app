import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, cloudflareConnections, instances, eq, and, isNotNull, isNull } from "@/db"
import { requireTeamManage } from "@/lib/team"
import { logAuditEvent } from "@/lib/audit"

/**
 * POST /api/integrations/cloudflare/disconnect
 *
 * Removes the stored token. DNS records we created in the user's zone are NOT
 * deleted (we no longer have a token to do so) — we return the affected
 * hostnames so the UI can warn that they'll be orphaned.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  // Shared team connection — only owners/admins may disconnect it.
  const team = await requireTeamManage(userId)
  if (!team) {
    return NextResponse.json(
      { error: "Only team owners and admins can disconnect an integration" },
      { status: 403 },
    )
  }

  const conn = await db.query.cloudflareConnections.findFirst({
    where: eq(cloudflareConnections.teamId, team.teamId),
  })
  if (!conn) {
    return NextResponse.json({ success: true, orphaned: [] })
  }

  // Instances still bound to a record in the team's zone — these become
  // orphaned (the record stays in Cloudflare) once the token is gone.
  const bound = await db.query.instances.findMany({
    where: and(
      eq(instances.teamId, team.teamId),
      isNotNull(instances.cfUserRecordId),
      isNull(instances.deletedAt),
    ),
    columns: { domain: true },
  })
  const orphaned = bound.map((i) => i.domain).filter((d): d is string => Boolean(d))

  await db.delete(cloudflareConnections).where(eq(cloudflareConnections.teamId, team.teamId))

  await logAuditEvent({
    userId,
    teamId: team.teamId,
    action: "cloudflare.disconnect",
    targetType: "cloudflare_connection",
    meta: { orphanedCount: orphaned.length },
  })

  return NextResponse.json({ success: true, orphaned })
}
