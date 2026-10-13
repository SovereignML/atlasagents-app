import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { restartCaddy } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import { readJsonBody } from "@/lib/request-body"
import { caddyRestartSchema } from "@/lib/validations"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const parsed = await readJsonBody(req, caddyRestartSchema, { allowEmpty: true })
  if (!parsed.ok) return parsed.res
  const mode = parsed.data.mode ?? "reload"

  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
  })

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Restarting ingress is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  if (instance.deploymentTarget !== "vps" && instance.deploymentTarget !== "byos") {
    return NextResponse.json(
      { error: "Caddy is only available on VPS and BYOS instances" },
      { status: 400 }
    )
  }
  if (instance.status !== "running") {
    return NextResponse.json(
      { error: `Cannot restart Caddy on instance in ${instance.status} state` },
      { status: 400 }
    )
  }
  if (!instance.ipAddress) {
    return NextResponse.json({ error: "Instance has no reachable host yet" }, { status: 400 })
  }

  try {
    await restartCaddy(instance, mode)
  } catch (err) {
    console.error(`[restart-caddy] ${mode} failed for ${instanceId}:`, err)
    await db.insert(instanceLogs).values({
      instanceId,
      level: "error",
      message: `Caddy ${mode} failed: ${err instanceof Error ? err.message : String(err)}`,
    })
    return NextResponse.json({ error: `Caddy ${mode} failed` }, { status: 500 })
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Caddy ${mode}ed by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.restart_caddy",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
  })

  return NextResponse.json({ success: true })
}
