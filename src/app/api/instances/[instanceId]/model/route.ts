import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { reprovisionBotEnv } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import { selectableModelsForRuntime } from "@/lib/allowed-models"
import {
  effectiveModel,
  modelTag,
  resolveLlmProvider,
  routeModel,
} from "@/lib/model-router"
import type { BudgetTier } from "@/lib/agent-config"

/**
 * Per-instance model picker. Lets a user switch which OpenRouter model their agent
 * runs, from the curated list of models valid for its runtime (chat models, and
 * ≥64k context for Hermes). Mirrors the agent-type change flow: persist → live
 * reprovision (graceful) → log + audit. NULL reverts to the tier default.
 *
 *   GET   — current selection, tier default, runtime, and selectable options.
 *   PATCH {modelSlug: string | null} — set/clear the per-instance model.
 */

/** Resolve the model an instance runs with no override (its tier default). */
function tierDefaultModel(instance: {
  runtime: string | null
  llmProvider: string | null
  modelTier: string | null
}): string {
  const tier = (instance.modelTier ?? "mid") as BudgetTier
  const llmProvider = resolveLlmProvider(instance)
  return effectiveModel({
    runtimeId: instance.runtime ?? "openclaw",
    llmProvider,
    tier,
    modelSlug: null,
    routedModel: routeModel(tier, llmProvider).model,
  })
}

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

  const options = await selectableModelsForRuntime(instance.runtime)
  return NextResponse.json({
    current: instance.modelSlug ?? null,
    tierDefault: tierDefaultModel(instance),
    runtime: instance.runtime ?? "openclaw",
    options: options.map((m) => ({
      slug: m.slug,
      label: m.label,
      contextLength: m.contextLength,
      tag: modelTag(m.slug),
    })),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  let body: { modelSlug?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Accept null/"" (revert to tier default) or a string slug.
  const raw = body.modelSlug
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    return NextResponse.json(
      { error: "modelSlug must be a string or null" },
      { status: 400 },
    )
  }
  const modelSlug = typeof raw === "string" && raw.trim() ? raw.trim() : null

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
  // Changing the model is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Enforce "only valid models": a non-null slug must be selectable for this runtime.
  if (modelSlug !== null) {
    const options = await selectableModelsForRuntime(instance.runtime)
    if (!options.some((m) => m.slug === modelSlug)) {
      return NextResponse.json(
        { error: `Model "${modelSlug}" is not available for this runtime` },
        { status: 400 },
      )
    }
  }

  if ((instance.modelSlug ?? null) === modelSlug) {
    return NextResponse.json({ success: true, modelSlug })
  }

  await db
    .update(instances)
    .set({ modelSlug })
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
      console.error(`[model] reprovision failed for ${instanceId}:`, err)
      await db.insert(instanceLogs).values({
        instanceId,
        level: "error",
        message: `Model updated but reprovision failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return NextResponse.json({
        success: true,
        warning: "Model saved but live update failed. Restart manually.",
        modelSlug,
      })
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Model changed to "${modelSlug ?? "tier default"}" by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.model_change",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
    meta: { from: instance.modelSlug ?? null, to: modelSlug },
  })

  return NextResponse.json({ success: true, modelSlug })
}
