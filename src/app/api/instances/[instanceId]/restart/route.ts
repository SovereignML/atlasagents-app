import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { restartBot } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"

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
  // Restart is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(session.user.id, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  if (instance.status !== "running" && instance.status !== "stopped") {
    return NextResponse.json(
      { error: `Cannot restart instance in ${instance.status} state` },
      { status: 400 }
    )
  }

  try {
    await restartBot(instance)
  } catch (err) {
    console.error(`[restart] failed for ${instanceId}:`, err)
    await db.insert(instanceLogs).values({
      instanceId,
      level: "error",
      message: `Restart failed: ${err instanceof Error ? err.message : String(err)}`,
    })
    return NextResponse.json({ error: "Restart failed" }, { status: 500 })
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Instance restarted by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.restart",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
  })

  return NextResponse.json({ success: true })
}
