import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { reprovisionBotEnv } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"
import { selectSkills } from "@/configs/skill-map"
import { generateSoul } from "@/lib/soul"
import type { AgentConfig } from "@/lib/agent-config"

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
  const { agentType } = body as { agentType?: string }

  if (!agentType || typeof agentType !== "string") {
    return NextResponse.json({ error: "agentType is required" }, { status: 400 })
  }

  const validSlugs = AGENT_CATEGORIES.map((c) => c.slug)
  if (!validSlugs.includes(agentType)) {
    return NextResponse.json(
      { error: `Invalid agentType. Must be one of: ${validSlugs.join(", ")}` },
      { status: 400 },
    )
  }

  const isAdmin = (session.user as { role?: string }).role === "admin"
  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(session.user.id, instanceId),
  })

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (!isAdmin && instance.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  const category = AGENT_CATEGORIES.find((c) => c.slug === agentType)!
  const prevConfig = (instance.agentConfig ?? {}) as Partial<AgentConfig>
  const updatedConfig: AgentConfig = {
    use_case: agentType,
    target_user: prevConfig.target_user ?? "",
    core_actions: category.examples ? [...category.examples] : [],
    tone: prevConfig.tone ?? "friendly",
    interface: prevConfig.interface ?? "web",
    deployment_target: prevConfig.deployment_target ?? "shared",
    knowledge_source: prevConfig.knowledge_source ?? "none",
    budget_tier: prevConfig.budget_tier ?? "mid",
    runtime: prevConfig.runtime ?? "openclaw",
    webui_enabled: prevConfig.webui_enabled ?? false,
  }

  const skills = selectSkills(updatedConfig)
  const soulMd = generateSoul(updatedConfig, skills)

  await db
    .update(instances)
    .set({
      agentType,
      agentConfig: updatedConfig,
      soulMd,
      skills,
    })
    .where(eq(instances.id, instanceId))

  if (instance.status === "running") {
    try {
      const freshInstance = await db.query.instances.findFirst({
        where: eq(instances.id, instanceId),
      })
      if (freshInstance) {
        await reprovisionBotEnv(freshInstance)
      }
    } catch (err) {
      console.error(`[agent-type] reprovision failed for ${instanceId}:`, err)
      await db.insert(instanceLogs).values({
        instanceId,
        level: "error",
        message: `Agent type updated but reprovision failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return NextResponse.json({
        success: true,
        warning: "Agent type saved but live update failed. Restart manually.",
        agentType,
      })
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Agent type changed to "${agentType}" by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.agent_type_change",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
    meta: { from: instance.agentType, to: agentType },
  })

  return NextResponse.json({ success: true, agentType })
}
