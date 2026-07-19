import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { collectOneServerMetric } from "@/lib/server-metrics"

/**
 * POST /api/instances/[instanceId]/metrics
 *
 * On-demand "Refresh" for the server hardware panel: probes this instance over
 * SSH and returns the fresh snapshot. Authorized as an owner/member who can see
 * the instance (viewer is enough — this is read-only observability, not an
 * operation). A reachable-but-failed probe returns 200 with health
 * "unreachable" so the UI can render the error badge.
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
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (instance.status !== "running") {
    return NextResponse.json({ error: "Instance must be running to collect metrics" }, { status: 400 })
  }
  if (!instance.ipAddress && !instance.byosHost) {
    return NextResponse.json({ error: "Instance has no server host yet" }, { status: 400 })
  }

  const result = await collectOneServerMetric(instance.id)
  return NextResponse.json(result)
}
