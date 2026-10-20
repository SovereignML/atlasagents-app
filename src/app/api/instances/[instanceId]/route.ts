import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, subscriptions, eq } from "@/db"
import { deleteBot } from "@/lib/provisioner"
import { releaseByosPlan } from "@/lib/byos-plan"
import { getInstanceAccessLevel, levelAtLeast } from "@/lib/instance-access"
import { IllegalTransitionError } from "@/lib/instance-state"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { logAuditEvent } from "@/lib/audit"
import { stripeIdempotencyKey } from "@/lib/stripe-idempotency"
import { instanceRenameSchema } from "@/lib/validations"

/**
 * REST-friendly DELETE alias for /api/instances/:id. Mirrors the POST /delete
 * handler — both surface errors and return 202 when retries are exhausted.
 */
export async function DELETE(
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
    where: eq(instances.id, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Deleting an agent is restricted to its creator and the team owner.
  if (!isAdmin && !(await getInstanceAccessLevel(effectiveUserId, instance.id)).isOwnerLike) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let result
  try {
    result = await deleteBot(instance)
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return NextResponse.json({ status: "already_deleting" }, { status: 200 })
    }
    console.error(`[instance DELETE] deleteBot failed for ${instanceId}:`, err)
    return NextResponse.json(
      { error: "Delete failed" },
      { status: 500 },
    )
  }

  // A BYOS agent's plan is not the agent's to cancel: plans are bought on
  // their own, and deleting the agent frees its plan for the next install. The
  // customer cancels plans from /dashboard/byos.
  const freedByosPlan =
    instance.deploymentTarget === "byos" && (await releaseByosPlan(instanceId))
  const sub = freedByosPlan
    ? null
    : await db.query.subscriptions.findFirst({
        where: eq(subscriptions.instanceId, instanceId),
      })
  if (sub) {
    if (isStripeConfigured() && sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId, undefined, {
          idempotencyKey: stripeIdempotencyKey("cancel-subscription", sub.stripeSubscriptionId),
        })
      } catch (err) {
        console.warn(`[instance DELETE] stripe cancel failed:`, err)
      }
    }
    await db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.id, sub.id))
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.delete",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
  })

  return NextResponse.json(result, {
    status: result.status === "deleted" ? 200 : 202,
  })
}

/**
 * Rename an agent. Only the display name changes: the slug, the agent's URL
 * and its server stay as they were, so nothing is reprovisioned. Managers (the
 * creator, the team owner and manager grants) may rename.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const parsed = instanceRenameSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const instance = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { id: true, name: true, status: true, teamId: true },
  })
  if (!instance || instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (!isAdmin && !levelAtLeast((await getInstanceAccessLevel(effectiveUserId, instance.id)).level, "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const name = parsed.data.name
  if (name !== instance.name) {
    await db.update(instances).set({ name }).where(eq(instances.id, instance.id))
    await logAuditEvent({
      userId: session.user.id,
      action: "instance.rename",
      teamId: instance.teamId,
      targetType: "instance",
      targetId: instance.id,
      targetLabel: name,
      onBehalfOfUserId: effectiveUserId !== session.user.id ? effectiveUserId : null,
      meta: { from: instance.name },
    })
  }
  return NextResponse.json({ id: instance.id, name })
}
