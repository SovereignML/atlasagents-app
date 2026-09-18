import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { retryProvisionBot } from "@/lib/provisioner"
import { PROVISIONING_TTL_MS } from "@/lib/reconciler"
import { decideRetryEligibility } from "@/lib/retry-eligibility"
import { isInstanceLockHeld } from "@/lib/instance-state"

// Retry a failed deployment by recreating from scratch: any partial provider
// VM + managed DNS record is torn down, provisioning state is cleared, and a
// brand-new provision run is kicked off in the background.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
  })

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Retry re-provisions the agent — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // A clean failure is retryable, and so is a deploy that STALLED — see
  // decideRetryEligibility for why the reconciler's TTL is the right threshold.
  const decision = decideRetryEligibility({
    status: instance.status,
    lastTransitionAt: instance.lastTransitionAt,
    createdAt: instance.createdAt,
    ttlMs: PROVISIONING_TTL_MS,
    // The authoritative signal: a live provision holds this lock for its whole
    // run, so this both protects a slow-but-working deploy from being retried
    // underneath itself and lets a genuinely dead one be retried in ~2 minutes
    // rather than after the TTL.
    lockHeld:
      instance.status === "provisioning" ? await isInstanceLockHeld(instance.id) : null,
  })
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: 409 })
  }
  const isStalled = decision.stalled

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message:
      `Retrying deployment (recreate from scratch), requested by ${isAdmin ? "admin" : "user"}` +
      `${isStalled ? " after the previous attempt stalled" : ""}.`,
  })

  // Fire-and-forget — provisioning runs in the background and the client polls
  // the status endpoint. Mirrors the deploy route's pattern.
  ;(async () => {
    try {
      const fresh = await db.query.instances.findFirst({
        where: eq(instances.id, instanceId),
      })
      if (fresh) await retryProvisionBot(fresh)
    } catch (err) {
      console.error(`[retry] retryProvisionBot failed for ${instanceId}:`, err)
    }
  })()

  return NextResponse.json({ status: "provisioning" })
}
