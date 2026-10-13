import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { reprovisionBotEnv } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"
import { getByoProvider } from "@/configs/llm-providers"
import { readJsonBody } from "@/lib/request-body"
import { byosKeySlotSchema } from "@/lib/validations"

/**
 * BYOS bring-your-own-key control. A BYO-key agent runs on the customer's own
 * key; when they've configured an optional fallback key (their OWN second
 * provider/key — never our managed key), this endpoint switches which key slot
 * is live. The switch is a platform-level swap: persist `byosActiveKeySlot`,
 * then reprovision the `.env` (resolveByosLlmCredentials reads the slot). There
 * is deliberately no path to our managed OpenRouter from here.
 *
 *   GET   — mode, provider labels, active slot, whether a fallback exists, status.
 *   PATCH {slot: "primary" | "fallback"} — switch the active key slot.
 */
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

  const hasFallback = !!instance.byosFallbackProvider
  return NextResponse.json({
    llmMode: instance.byosLlmMode ?? null,
    activeSlot: instance.byosActiveKeySlot ?? "primary",
    keyStatus: instance.byosKeyStatus ?? "unknown",
    hasFallback,
    ownProvider: instance.byosOwnProvider ?? "openrouter",
    ownProviderLabel:
      getByoProvider(instance.byosOwnProvider)?.label ??
      getByoProvider("openrouter")!.label,
    fallbackProvider: instance.byosFallbackProvider ?? null,
    fallbackProviderLabel: hasFallback
      ? (getByoProvider(instance.byosFallbackProvider)?.label ?? instance.byosFallbackProvider)
      : null,
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
  const parsed = await readJsonBody(req, byosKeySlotSchema)
  if (!parsed.ok) return parsed.res
  const { slot } = parsed.data

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
  // Switching keys is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Only meaningful for a BYO own-key agent.
  if (instance.byosLlmMode !== "own_key") {
    return NextResponse.json(
      { error: "This agent does not use a bring-your-own key" },
      { status: 400 },
    )
  }
  // Switching to fallback requires a configured fallback key.
  if (slot === "fallback" && !instance.byosFallbackProvider) {
    return NextResponse.json(
      { error: "No fallback key is configured for this agent" },
      { status: 400 },
    )
  }

  const currentSlot = instance.byosActiveKeySlot ?? "primary"
  if (currentSlot === slot) {
    return NextResponse.json({ success: true, activeSlot: slot })
  }

  await db
    .update(instances)
    .set({ byosActiveKeySlot: slot, byosKeyStatus: "unknown" })
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
      console.error(`[byos-key] reprovision failed for ${instanceId}:`, err)
      await db.insert(instanceLogs).values({
        instanceId,
        level: "error",
        message: `Key slot set to "${slot}" but reprovision failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      })
      return NextResponse.json({
        success: true,
        warning: "Key slot saved but live update failed. Restart manually.",
        activeSlot: slot,
      })
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Active LLM key switched to ${slot} by ${isAdmin ? "admin" : "user"}.`,
  })

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.byos_key_switch",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
    meta: { from: currentSlot, to: slot },
  })

  return NextResponse.json({ success: true, activeSlot: slot })
}
