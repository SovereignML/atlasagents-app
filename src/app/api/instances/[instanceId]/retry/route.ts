import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { retryProvisionBot } from "@/lib/provisioner"

// Retry a failed deployment by recreating from scratch: any partial provider
// VM + managed DNS record is torn down, provisioning state is cleared, and a
// brand-new provision run is kicked off in the background.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"

  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(session.user.id, instanceId),
  })

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Retry re-provisions the agent — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(session.user.id, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status !== "failed_provisioning") {
    return NextResponse.json(
      { error: `Cannot retry instance in ${instance.status} state` },
      { status: 409 }
    )
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Retrying deployment (recreate from scratch) — requested by ${isAdmin ? "admin" : "user"}.`,
  })

  // Fire-and-forget — provisioning runs in the background and the client polls
  // the status endpoint. Mirrors the deploy route's pattern.
  ;(async () => {
    try {
      const fresh = await db.query.instances.findFirst({
        where: eq(instances.id, instanceId),
      })
      if (fresh) await retryProvisionBot(fresh)
    } catch (err) {
      console.error(`[retry] retryProvisionBot failed for ${instanceId}:`, err)
    }
  })()

  return NextResponse.json({ status: "provisioning" })
}
