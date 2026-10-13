import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { installToolDependencies, reprovisionBotEnv } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import {
  AGENT_SKILLS,
  getSkill,
  requiredToolsForSkills,
} from "@/configs/agent-skills"
import {
  getTool,
  toolSupportedOn,
  knowledgeBaseEnabled,
} from "@/configs/agent-tools"
import { generateSoul } from "@/lib/soul"
import type { AgentConfig } from "@/lib/agent-config"
import type { RuntimeId } from "@/lib/runtimes"
import { readJsonBody } from "@/lib/request-body"
import { instanceSkillsSchema } from "@/lib/validations"

/** GET — enabled skills + the full catalog + the agent's current enabled tools. */
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
    enabledSkills: (instance.skills as string[] | null) ?? [],
    catalog: AGENT_SKILLS,
    enabledTools: instance.enabledTools ?? [],
  })
}

/** PATCH — set the full enabled-skills array; auto-enable required tools, regenerate identity, reprovision if running. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const parsed = await readJsonBody(req, instanceSkillsSchema)
  if (!parsed.ok) return parsed.res
  // De-dupe while preserving order.
  const ids = [...new Set(parsed.data.enabledSkills)]

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
  // Changing skills is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  // Validate every id: known + shippable.
  for (const id of ids) {
    const skill = getSkill(id)
    if (!skill) {
      return NextResponse.json({ error: `Unknown skill: ${id}` }, { status: 400 })
    }
    if (skill.comingSoon) {
      return NextResponse.json(
        { error: `Skill "${skill.name}" is not available yet.` },
        { status: 400 },
      )
    }
  }

  // Auto-enable the tools these skills require — union with the current set,
  // dropping any tool that's unknown, comingSoon, or unsupported on this runtime.
  const runtime = instance.runtime as RuntimeId
  const prevTools = instance.enabledTools ?? []
  const wanted = requiredToolsForSkills(ids)
  const mergedTools = [...new Set([...prevTools, ...wanted])].filter((tid) => {
    const tool = getTool(tid)
    return !!tool && !tool.comingSoon && toolSupportedOn(tool, runtime)
  })
  const newlyEnabledTools = mergedTools.filter((t) => !prevTools.includes(t))

  // Regenerate SOUL.md (best-effort — only when we have a stored agent config).
  const agentConfig = instance.agentConfig as AgentConfig | null
  const soulMd = agentConfig
    ? generateSoul(agentConfig, ids, {
        hasKnowledgeBase: knowledgeBaseEnabled(mergedTools),
      })
    : instance.soulMd

  await db
    .update(instances)
    .set({ skills: ids, enabledTools: mergedTools, soulMd })
    .where(eq(instances.id, instanceId))

  // Warn (don't fail) if an auto-enabled tool needs a provider API key the user
  // may not have configured yet.
  const keyTools = newlyEnabledTools
    .map((t) => getTool(t))
    .filter((t) => t?.requiresApiKey)
    .map((t) => t!.name)

  // Apply to the live agent: install deps for any newly-enabled tools, then
  // rewrite identity/config + restart. Keep the DB change on failure (mirrors
  // the tools/agent-type routes) so a transient SSH error doesn't lose the choice.
  if (instance.status === "running") {
    try {
      const freshInstance = await db.query.instances.findFirst({
        where: eq(instances.id, instanceId),
      })
      if (freshInstance) {
        await installToolDependencies(freshInstance, mergedTools)
        await reprovisionBotEnv(freshInstance)
      }
    } catch (err) {
      console.error(`[skills] apply failed for ${instanceId}:`, err)
      await db.insert(instanceLogs).values({
        instanceId,
        level: "error",
        message: `Skills updated but live apply failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return NextResponse.json({
        success: true,
        warning: "Skills saved but live update failed. Restart the agent to apply.",
        enabledSkills: ids,
        enabledTools: mergedTools,
        autoEnabledTools: newlyEnabledTools,
      })
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Skills updated to [${ids.join(", ") || "none"}]${
      newlyEnabledTools.length ? ` (auto-enabled tools: ${newlyEnabledTools.join(", ")})` : ""
    } by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.skills_change",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
    meta: { from: (instance.skills as string[] | null) ?? [], to: ids, autoEnabledTools: newlyEnabledTools },
  })

  return NextResponse.json({
    success: true,
    enabledSkills: ids,
    enabledTools: mergedTools,
    autoEnabledTools: newlyEnabledTools,
    ...(keyTools.length
      ? {
          warning: `Enabled ${keyTools.join(", ")} — these may need a provider API key configured to work.`,
        }
      : {}),
  })
}
