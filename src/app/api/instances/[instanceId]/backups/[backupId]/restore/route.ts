import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, subscriptions, backupRecords, eq, and } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { logAuditEvent } from "@/lib/audit"
import { driveErrorResponse } from "@/lib/drive-errors"
import { getDriveAccessTokenForTeam, downloadBackup } from "@/lib/google-drive"
import { validateBackupEnvelope, resolveRestoreFields } from "@/lib/agent-backup"
import { createInstanceFromAgentFields } from "@/lib/agent-create"
import { reprovisionBotEnv, provisionBot } from "@/lib/provisioner"
import { describeVmError } from "@/lib/vm-provider"
import { findPlanBySlug } from "@/configs/plans"
import { addPlanCredits } from "@/lib/wallet"
import { planPeriodEnd } from "@/lib/plan-period"

const BodySchema = z.object({
  mode: z.enum(["new", "in_place"]),
  targetInstanceId: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  // Plan for restore-as-new. v1 defaults to the free tier (see note below).
  planSlug: z.string().optional(),
})

/**
 * POST /api/instances/[instanceId]/backups/[backupId]/restore
 *
 * Restore a Drive backup either by overwriting an existing agent's settings
 * (mode "in_place") or by creating a brand-new agent (mode "new").
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string; backupId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId, backupId } = await params
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { mode } = parsed.data
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  // ── Locate the backup via its source instance (ownership gate) ──────
  const sourceInstance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!sourceInstance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Restoring is an operation — requires Operator+ on the source agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, sourceInstance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const record = await db.query.backupRecords.findFirst({
    where: and(eq(backupRecords.id, backupId), eq(backupRecords.instanceId, sourceInstance.id)),
  })
  if (!record) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 })
  }
  const ownerId = sourceInstance.userId

  // ── Download + validate the backup content ──────────────────────────
  let fields: ReturnType<typeof resolveRestoreFields>
  try {
    const accessToken = await getDriveAccessTokenForTeam(sourceInstance.teamId)
    const raw = await downloadBackup(accessToken, record.driveFileId)
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: "Backup file is not valid JSON." }, { status: 400 })
    }
    const result = validateBackupEnvelope(json)
    if (!result.ok) {
      return NextResponse.json({ error: `Invalid backup: ${result.error}` }, { status: 400 })
    }
    fields = resolveRestoreFields(result.data)
  } catch (err) {
    const mapped = driveErrorResponse(err)
    if (mapped) return mapped
    console.error(`[restore] download failed for ${backupId}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Could not read backup from Drive." }, { status: 500 })
  }

  // ── Restore in place: overwrite an existing agent's settings ────────
  if (mode === "in_place") {
    const targetId = parsed.data.targetInstanceId ?? instanceId
    const target = await db.query.instances.findFirst({
      where: isAdmin
        ? eq(instances.id, targetId)
        : whereUserInstanceVisible(effectiveUserId, targetId),
    })
    if (!target) {
      return NextResponse.json({ error: "Target agent not found" }, { status: 404 })
    }
    // In-place restore overwrites the target's settings — Operator+ on the target.
    if (!isAdmin && !(await canOperateInstance(effectiveUserId, target.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (target.status !== "running" && target.status !== "stopped") {
      return NextResponse.json(
        { error: `Cannot restore into an agent that is ${target.status}.` },
        { status: 409 },
      )
    }

    // Overwrite behavioral settings only. We intentionally leave slug,
    // infrastructure (region/serverConfig/host), deploymentTarget/runtime,
    // secrets, and status untouched — restoring those onto live infra would be
    // inconsistent with the agent's actual provisioned resources.
    await db
      .update(instances)
      .set({
        name: fields.name,
        agentType: fields.agentType,
        agentConfig: fields.agentConfig,
        soulMd: fields.soulMd,
        skills: fields.skills,
        modelTier: fields.modelTier,
        interfaceKind: fields.interfaceKind,
      })
      .where(eq(instances.id, target.id))

    await logAuditEvent({
      userId: session.user.id,
      action: "instance.backup.restore",
      targetType: "instance",
      targetId: target.id,
      targetLabel: fields.name,
      meta: { mode: "in_place", backupId, fileName: record.fileName },
    })

    if (target.status === "running") {
      try {
        const fresh = await db.query.instances.findFirst({ where: eq(instances.id, target.id) })
        if (fresh) await reprovisionBotEnv(fresh)
      } catch (err) {
        console.error(`[restore] reprovision failed for ${target.id}:`, err)
        await db.insert(instanceLogs).values({
          instanceId: target.id,
          level: "error",
          message: `Settings restored from backup but live update failed: ${err instanceof Error ? err.message : String(err)}`,
        })
        return NextResponse.json({
          success: true,
          mode: "in_place",
          instanceId: target.id,
          warning: "Settings restored but live update failed. Restart the agent manually.",
        })
      }
    }

    await db.insert(instanceLogs).values({
      instanceId: target.id,
      level: "info",
      message: `Settings restored from backup ${record.fileName}.`,
    })

    return NextResponse.json({ success: true, mode: "in_place", instanceId: target.id })
  }

  // ── Restore as a new agent ──────────────────────────────────────────
  if (!fields.agentConfig) {
    return NextResponse.json(
      { error: "This backup has no agent configuration to recreate." },
      { status: 400 },
    )
  }
  // BYOS agents depend on a customer server connection (host/credentials) that
  // is deliberately NOT part of a no-secrets backup, so a new BYOS agent can't
  // be reconstructed. Restore in place onto a reconnected BYOS agent instead.
  if (fields.deploymentTarget === "byos") {
    return NextResponse.json(
      { error: "BYOS agents can't be recreated from a backup. Use restore in place instead." },
      { status: 400 },
    )
  }

  // v1 billing policy: restore-as-new provisions on the free tier and enforces
  // the one-free-instance guard. Paid-tier cloning/billing is deferred — use
  // restore in place for existing paid agents. (Flagged for product.)
  const planSlug = parsed.data.planSlug ?? "free"
  const planConfig = findPlanBySlug(planSlug)
  if (!planConfig) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }
  if (planConfig.tier !== "free") {
    return NextResponse.json(
      {
        error:
          "Restoring as a new paid agent isn't supported yet. Deploy the plan first, then restore in place.",
        code: "paid_restore_unsupported",
      },
      { status: 409 },
    )
  }

  // Enforce the same one-free-instance guard as the deploy route.
  const existingFree = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.userId, ownerId), eq(subscriptions.status, "active")),
    with: { plan: true },
  })
  if (existingFree && existingFree.plan?.tier === "free") {
    return NextResponse.json(
      { error: "You already have a free agent. Upgrade to deploy more.", code: "free_limit" },
      { status: 409 },
    )
  }

  const created = await createInstanceFromAgentFields({
    userId: ownerId,
    name: parsed.data.name ?? fields.name,
    agentConfig: fields.agentConfig as Parameters<typeof createInstanceFromAgentFields>[0]["agentConfig"],
    planSlug,
    auditAction: "instance.backup.restore",
    auditMeta: { mode: "new", backupId, fileName: record.fileName },
  })
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: created.status })
  }
  const { instance, planConfig: createdPlan, dbPlan } = created
  const newId = instance.id

  // Free-tier flow (mirror of the deploy route): auto-provision, activate a
  // subscription, and grant the plan's credits.
  ;(async () => {
    try {
      const fresh = await db.query.instances.findFirst({ where: eq(instances.id, newId) })
      if (fresh) await provisionBot(fresh)
    } catch (err) {
      console.error("[restore] provisionBot failed (new agent):", await describeVmError(err))
    }
  })()

  if (dbPlan) {
    await db.insert(subscriptions).values({
      userId: ownerId,
      planId: dbPlan.id,
      instanceId: newId,
      interval: "month",
      status: "active",
    })
  }
  if (createdPlan.creditsPerPeriod > 0) {
    try {
      // New instance from a restore → ADD to the wallet (don't expire the
      // user's other agents' plan credits).
      await addPlanCredits(
        ownerId,
        createdPlan.creditsPerPeriod,
        planPeriodEnd("month"),
        `Restore grant: ${createdPlan.name}`,
        newId,
      )
    } catch (err) {
      console.error("[restore] depositToWallet failed:", err)
    }
  }

  await db.insert(instanceLogs).values({
    instanceId: newId,
    level: "info",
    message: `Agent restored from backup ${record.fileName}. Provisioning started.`,
  })

  return NextResponse.json({ success: true, mode: "new", instanceId: newId })
}
