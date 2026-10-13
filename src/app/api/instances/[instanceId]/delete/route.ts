import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, subscriptions, eq } from "@/db"
import { deleteBot } from "@/lib/provisioner"
import { getInstanceAccessLevel } from "@/lib/instance-access"
import { IllegalTransitionError } from "@/lib/instance-state"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { logAuditEvent } from "@/lib/audit"
import { stripeIdempotencyKey } from "@/lib/stripe-idempotency"

// POST /api/instances/:instanceId/delete
//
// Authoritative delete. On success returns:
//   200 { status: "deleted" }  — Linode VM is gone, DB row is deleted.
//   202 { status: "pending" }  — retries exhausted; reconciler will sweep.
//
// Errors are surfaced; we no longer silently mark the row deleted.
export async function POST(
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
      // Row is already deleting/deleted — this is a double-click, treat as OK.
      return NextResponse.json({ status: "already_deleting" }, { status: 200 })
    }
    return apiError(`delete ${instanceId}`, err, "Delete failed.")
  }

  // Cancel linked subscription regardless — the row is at least in `deleting`.
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.instanceId, instanceId),
  })
  if (sub) {
    if (isStripeConfigured() && sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId, undefined, {
          idempotencyKey: stripeIdempotencyKey("cancel-subscription", sub.stripeSubscriptionId),
        })
      } catch (err) {
        console.warn(`[delete] stripe cancel failed:`, err)
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
