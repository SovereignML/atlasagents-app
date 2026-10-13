import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { reprovisionBotEnv } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import { selectSkills } from "@/configs/skill-map"
import { generateSoul } from "@/lib/soul"
import type { AgentConfig } from "@/lib/agent-config"
import { readJsonBody } from "@/lib/request-body"
import { customInstructionsSchema } from "@/lib/validations"

/** Cap to keep the persona prompt sane and the DB row small. */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const parsed = await readJsonBody(req, customInstructionsSchema)
  if (!parsed.ok) return parsed.res
  const { customInstructions } = parsed.data

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
  // Editing the persona is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const prevConfig = (instance.agentConfig ?? {}) as Partial<AgentConfig>
  const updatedConfig: AgentConfig = {
    use_case: prevConfig.use_case ?? instance.agentType ?? "custom",
    target_user: prevConfig.target_user ?? "",
    core_actions: prevConfig.core_actions ?? [],
    tone: prevConfig.tone ?? "friendly",
    interface: prevConfig.interface ?? "web",
    deployment_target: prevConfig.deployment_target ?? "shared",
    knowledge_source: prevConfig.knowledge_source ?? "none",
    budget_tier: prevConfig.budget_tier ?? "mid",
    custom_instructions: customInstructions,
    runtime: prevConfig.runtime ?? "openclaw",
    webui_enabled: prevConfig.webui_enabled ?? false,
  }

  const skills = selectSkills(updatedConfig)
  const soulMd = generateSoul(updatedConfig, skills)

  await db
    .update(instances)
    .set({ agentConfig: updatedConfig, soulMd })
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
      console.error(`[custom-instructions] reprovision failed for ${instanceId}:`, err)
      await db.insert(instanceLogs).values({
        instanceId,
        level: "error",
        message: `Custom instructions saved but reprovision failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return NextResponse.json({
        success: true,
        warning: "Saved but live update failed. Restart the agent to apply.",
      })
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: customInstructions
      ? "Custom instructions updated."
      : "Custom instructions cleared.",
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.custom_instructions_change",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
  })

  return NextResponse.json({ success: true })
}
