import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, subscriptions, eq } from "@/db"
import { deleteBot } from "@/lib/provisioner"
import { getInstanceAccessLevel } from "@/lib/instance-access"
import { IllegalTransitionError } from "@/lib/instance-state"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { logAuditEvent } from "@/lib/audit"

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

  const instance = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Deleting an agent is restricted to its creator and the team owner.
  if (!isAdmin && !(await getInstanceAccessLevel(session.user.id, instance.id)).isOwnerLike) {
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

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.instanceId, instanceId),
  })
  if (sub) {
    if (isStripeConfigured() && sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
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
