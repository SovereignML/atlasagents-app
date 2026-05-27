import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, cloudflareConnections, instances, eq, and, isNotNull, isNull } from "@/db"
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

  const conn = await db.query.cloudflareConnections.findFirst({
    where: eq(cloudflareConnections.userId, userId),
  })
  if (!conn) {
    return NextResponse.json({ success: true, orphaned: [] })
  }

  // Instances still bound to a record in the user's zone — these become
  // orphaned (the record stays in Cloudflare) once the token is gone.
  const bound = await db.query.instances.findMany({
    where: and(
      eq(instances.userId, userId),
      isNotNull(instances.cfUserRecordId),
      isNull(instances.deletedAt),
    ),
    columns: { domain: true },
  })
  const orphaned = bound.map((i) => i.domain).filter((d): d is string => Boolean(d))

  await db.delete(cloudflareConnections).where(eq(cloudflareConnections.userId, userId))

  await logAuditEvent({
    userId,
    action: "cloudflare.disconnect",
    targetType: "cloudflare_connection",
    meta: { orphanedCount: orphaned.length },
  })

  return NextResponse.json({ success: true, orphaned })
}
