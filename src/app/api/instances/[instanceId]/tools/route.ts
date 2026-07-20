import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { installToolDependencies, reprovisionBotEnv } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import {
  AGENT_TOOLS,
  getTool,
  toolSupportedOn,
} from "@/configs/agent-tools"
import type { RuntimeId } from "@/lib/runtimes"

/** GET — enabled tools + the full catalog + this agent's runtime (for availability). */
export async function GET(
  _req: NextRequest,
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
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(effectiveUserId, instanceId),
  })

  if (!instance || instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  return NextResponse.json({
    enabledTools: instance.enabledTools ?? [],
    catalog: AGENT_TOOLS,
    runtime: instance.runtime,
  })
}

/** PATCH — set the full enabled-tools array; install deps + reprovision if running. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const body = await req.json()
  const { enabledTools } = body as { enabledTools?: unknown }

  if (
    !Array.isArray(enabledTools) ||
    !enabledTools.every((t) => typeof t === "string")
  ) {
    return NextResponse.json(
      { error: "enabledTools must be an array of strings" },
      { status: 400 },
    )
  }
  // De-dupe while preserving order.
  const ids = [...new Set(enabledTools as string[])]

  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(effectiveUserId, instanceId),
  })

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Changing tools is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  // Validate every id: known, shippable, and supported on this runtime.
  const runtime = instance.runtime as RuntimeId
  for (const id of ids) {
    const tool = getTool(id)
    if (!tool) {
      return NextResponse.json({ error: `Unknown tool: ${id}` }, { status: 400 })
    }
    if (tool.comingSoon) {
      return NextResponse.json(
        { error: `Tool "${tool.name}" is not available yet.` },
        { status: 400 },
      )
    }
    if (!toolSupportedOn(tool, runtime)) {
      return NextResponse.json(
        { error: `Tool "${tool.name}" is not supported on ${runtime}.` },
        { status: 400 },
      )
    }
  }

  await db
    .update(instances)
    .set({ enabledTools: ids })
    .where(eq(instances.id, instanceId))

  // Apply to the live agent: install system deps first, then rewrite config +
  // restart. Keep the DB change on failure (mirrors agent-type) so a transient
  // SSH/apt error doesn't lose the user's choice — it re-applies on next provision.
  if (instance.status === "running") {
    try {
      const freshInstance = await db.query.instances.findFirst({
        where: eq(instances.id, instanceId),
      })
      if (freshInstance) {
        await installToolDependencies(freshInstance, ids)
        await reprovisionBotEnv(freshInstance)
      }
    } catch (err) {
      console.error(`[tools] apply failed for ${instanceId}:`, err)
      await db.insert(instanceLogs).values({
        instanceId,
        level: "error",
        message: `Tools updated but live apply failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return NextResponse.json({
        success: true,
        warning: "Tools saved but live update failed. Restart the agent to apply.",
        enabledTools: ids,
      })
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Tools updated to [${ids.join(", ") || "none"}] by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.tools_change",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
    meta: { from: instance.enabledTools ?? [], to: ids },
  })

  return NextResponse.json({ success: true, enabledTools: ids })
}
