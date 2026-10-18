// BYOS plans: one plan per agent, bought independently of servers.
//
// A BYOS plan is a recurring subscription (plan tier "byos") that entitles ONE
// agent. It is either available (instanceId NULL — bought ahead, waiting for an
// install) or assigned (instanceId set — covering that agent). Plans are bought
// with no server involved, and connecting a server needs no plan. Installing an
// agent takes an available plan, or opens Checkout for a new one and installs once it
// is paid (src/app/api/byos/deploy/route.ts). Deleting the agent frees its plan
// for the next one; cancelling the plan stops its agent when the paid period
// ends.
//
// Legacy: before this, plans were bought per server (Subscription.byosServerId)
// and covered every agent on it. Those rows are grandfathered until they end —
// they keep covering their server and are never handed out as available plans.
//
// Pure rules (which statuses count, which path an install takes) are in
// byos-install.ts.

import {
  db,
  byosServers,
  instances,
  plans,
  subscriptions,
  and,
  asc,
  eq,
  inArray,
  lt,
  ne,
  notInArray,
  sql,
} from "@/db"
import {
  INSTALLABLE_PLAN_STATUS_LIST,
  LIVE_PLAN_STATUS_LIST,
  pickBestPlan,
  planIsLive,
} from "@/lib/byos-install"
import { logInstanceEvent } from "@/lib/instance-state"
import { notify } from "@/lib/notifications/dispatch"

export type ByosPlan = {
  subscriptionId: string
  stripeSubscriptionId: string | null
  status: string
  interval: string
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  createdAt: Date
  /** The agent this plan covers, or null while the plan is available. */
  instanceId: string | null
  /** Set only on a grandfathered per-server plan. */
  byosServerId: string | null
}

const planColumns = {
  subscriptionId: subscriptions.id,
  stripeSubscriptionId: subscriptions.stripeSubscriptionId,
  status: subscriptions.status,
  interval: subscriptions.interval,
  currentPeriodEnd: subscriptions.currentPeriodEnd,
  cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
  createdAt: subscriptions.createdAt,
  instanceId: subscriptions.instanceId,
  byosServerId: subscriptions.byosServerId,
}

/** Subscription rows whose plan is the BYOS plan. */
const isByosTier = inArray(
  subscriptions.planId,
  db.select({ id: plans.id }).from(plans).where(eq(plans.tier, "byos")),
)

/** Every live BYOS plan this user owns, oldest first. */
export async function listByosPlans(userId: string): Promise<ByosPlan[]> {
  return db
    .select(planColumns)
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        isByosTier,
        inArray(subscriptions.status, LIVE_PLAN_STATUS_LIST),
      ),
    )
    .orderBy(asc(subscriptions.createdAt))
}

/** A plan that can take a new agent: paid up, unassigned, not a per-server plan. */
export function isAvailablePlan(plan: ByosPlan): boolean {
  return (
    plan.instanceId === null &&
    plan.byosServerId === null &&
    (INSTALLABLE_PLAN_STATUS_LIST as string[]).includes(plan.status)
  )
}

/**
 * Assign one of the user's available plans to `instanceId`, atomically. Returns
 * the plan, or null if none is available. Used for a new install, and to bring back an
 * agent that was stopped when its plan ended.
 *
 * Single statement with FOR UPDATE SKIP LOCKED (the warm pool's claim pattern),
 * so two installs at once can never take the same plan.
 */
export async function claimAvailableByosPlan(
  userId: string,
  instanceId: string,
): Promise<{ subscriptionId: string; interval: string } | null> {
  // An agent whose plan ended still has that dead row pointing at it, and
  // Subscription.instanceId is unique — detach it before the claim.
  await db
    .update(subscriptions)
    .set({ instanceId: null })
    .where(
      and(
        eq(subscriptions.instanceId, instanceId),
        notInArray(subscriptions.status, LIVE_PLAN_STATUS_LIST),
      ),
    )
  const installable = sql.join(
    INSTALLABLE_PLAN_STATUS_LIST.map((s) => sql`${s}`),
    sql`, `,
  )
  const res = await db.execute(sql`
    UPDATE "Subscription"
    SET "instanceId" = ${instanceId}, "updatedAt" = now()
    WHERE id = (
      SELECT s.id FROM "Subscription" s
      JOIN "Plan" p ON p.id = s."planId"
      WHERE s."userId" = ${userId}
        AND p.tier = 'byos'
        AND s."instanceId" IS NULL
        AND s."byosServerId" IS NULL
        AND s.status IN (${installable})
      ORDER BY s."createdAt" ASC
      LIMIT 1
      FOR UPDATE OF s SKIP LOCKED
    )
    RETURNING id, interval;
  `)
  const row = (res as unknown as { rows: Array<{ id: string; interval: string }> }).rows?.[0]
  return row ? { subscriptionId: String(row.id), interval: String(row.interval) } : null
}

/**
 * Free the plan assigned to a deleted BYOS agent so the next install can use
 * it. The subscription keeps billing — the customer cancels plans separately.
 */
export async function releaseByosPlan(instanceId: string): Promise<boolean> {
  const released = await db
    .update(subscriptions)
    .set({ instanceId: null })
    .where(and(eq(subscriptions.instanceId, instanceId), isByosTier))
    .returning({ id: subscriptions.id })
  return released.length > 0
}

/**
 * The live grandfathered per-server plan covering each of these servers.
 * Servers without one are absent from the map.
 */
export async function findLegacyServerPlans(
  serverIds: string[],
): Promise<Map<string, ByosPlan>> {
  const out = new Map<string, ByosPlan>()
  if (serverIds.length === 0) return out
  const rows = await db
    .select(planColumns)
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.byosServerId, serverIds),
        inArray(subscriptions.status, LIVE_PLAN_STATUS_LIST),
      ),
    )
  const byServer = new Map<string, ByosPlan[]>()
  for (const row of rows) {
    if (!row.byosServerId) continue
    byServer.set(row.byosServerId, [...(byServer.get(row.byosServerId) ?? []), row])
  }
  for (const [serverId, list] of byServer) {
    const best = pickBestPlan(list)
    if (best) out.set(serverId, best)
  }
  return out
}

export async function findLegacyServerPlan(serverId: string): Promise<ByosPlan | null> {
  return (await findLegacyServerPlans([serverId])).get(serverId) ?? null
}

/**
 * Whether a BYOS agent is allowed to run right now: its own plan, its server's
 * legacy plan, or — for an agent that never had a plan of its own — a live plan
 * on another agent on the same server.
 *
 * That last rule grandfathers the per-server era: a plan bought per agent
 * before it counted as a plan for its whole server, so agents installed then
 * carry no Subscription row and lean on a sibling's. An agent installed since
 * always gets its own row, and a row stays pointed at its agent after the plan
 * ends, so a lapsed agent can't fall back on a sibling's plan.
 */
export async function byosAgentIsCovered(instance: {
  id: string
  deploymentTarget: string | null
  byosServerId: string | null
}): Promise<boolean> {
  if (instance.deploymentTarget !== "byos") return true
  const ownRows = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.instanceId, instance.id))
  if (ownRows.some((r) => planIsLive(r.status))) return true
  if (!instance.byosServerId) return false
  if (await findLegacyServerPlan(instance.byosServerId)) return true
  if (ownRows.length > 0) return false
  const sibling = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(instances, eq(subscriptions.instanceId, instances.id))
    .where(
      and(
        eq(instances.byosServerId, instance.byosServerId),
        ne(instances.id, instance.id),
        ne(instances.status, "deleted"),
        isByosTier,
        inArray(subscriptions.status, LIVE_PLAN_STATUS_LIST),
      ),
    )
    .limit(1)
  return sibling.length > 0
}

/**
 * Stop the running BYOS agents among `instanceIds` that no live plan covers any
 * more. Called from customer.subscription.deleted, which Stripe sends at the
 * END of the paid period for a cancel, so agents run through every month that
 * was paid for.
 *
 * Stopping, not deleting — the agent and its data stay on the customer's
 * machine, and it starts again from the agent page once it has a plan.
 */
export async function stopUncoveredByosAgents(instanceIds: string[]): Promise<number> {
  if (instanceIds.length === 0) return 0
  const running = await db.query.instances.findMany({
    where: and(
      inArray(instances.id, instanceIds),
      eq(instances.deploymentTarget, "byos"),
      eq(instances.status, "running"),
    ),
  })

  const { pauseBot } = await import("@/lib/provisioner")
  const stoppedByOwner = new Map<string, string[]>()
  for (const instance of running) {
    if (await byosAgentIsCovered(instance)) continue
    try {
      await pauseBot(instance)
    } catch (err) {
      console.warn(`[byos-plan] pauseBot failed for ${instance.id}:`, err)
      continue
    }
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "subscription",
      action: "byos_plan_ended",
      message: "The BYOS plan for this agent ended, so the agent was stopped.",
    })
    stoppedByOwner.set(instance.userId, [...(stoppedByOwner.get(instance.userId) ?? []), instance.name])
  }

  let stopped = 0
  for (const [userId, names] of stoppedByOwner) {
    stopped += names.length
    const which = names.length === 1 ? names[0] : `${names.length} agents`
    await notify({
      userId,
      category: "billing",
      type: "byos_plan_ended",
      title: `BYOS plan ended for ${which}`,
      message: `The BYOS plan for ${which} has ended, so ${names.length === 1 ? "it was" : "they were"} stopped. Nothing on your server was deleted — buy a BYOS plan to start ${names.length === 1 ? "it" : "them"} again.`,
      url: "/dashboard/byos",
    })
  }
  return stopped
}

/** The non-deleted BYOS agents on a server — what a legacy per-server plan covered. */
export async function byosAgentIdsOnServer(serverId: string): Promise<string[]> {
  const rows = await db
    .select({ id: instances.id })
    .from(instances)
    .where(and(eq(instances.byosServerId, serverId), ne(instances.status, "deleted")))
  return rows.map((r) => r.id)
}

/** The available plans a user can install onto right now. */
export async function countAvailableByosPlans(userId: string): Promise<number> {
  return (await listByosPlans(userId)).filter(isAvailablePlan).length
}

/** Servers' labels for plan rows, used by the plan list. */
export async function serverLabels(serverIds: string[]): Promise<Map<string, string>> {
  if (serverIds.length === 0) return new Map()
  const rows = await db
    .select({ id: byosServers.id, label: byosServers.label })
    .from(byosServers)
    .where(inArray(byosServers.id, serverIds))
  return new Map(rows.map((r) => [r.id, r.label]))
}

// ── Installs that were never paid for ──────────────────────────────────
//
// An install with no available plan leaves its agent `pending` while the customer is
// at Checkout. If they back out, nothing was installed and nothing should stay:
// the row counts against the team's agent cap (countTeamAgents) and holds its
// slug. Checkout Sessions expire after 24h, so an older one can't be paid.

const UNPAID_INSTALL_MAX_AGE_MS = 25 * 60 * 60 * 1000

/** A BYOS agent row that is still waiting on its plan's payment. */
const isUnpaidByosInstall = and(
  eq(instances.deploymentTarget, "byos"),
  eq(instances.status, "pending"),
  sql`NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."instanceId" = ${instances.id})`,
)

/**
 * Soft-delete one unpaid BYOS install, scoped to its team. Returns whether it
 * did. A payment that lands afterwards is still recorded — as an available plan
 * (handlePaidSubscriptionCheckout).
 */
export async function discardUnpaidByosInstall(instanceId: string, teamId: string): Promise<boolean> {
  const rows = await db
    .update(instances)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(and(eq(instances.id, instanceId), eq(instances.teamId, teamId), isUnpaidByosInstall))
    .returning({ id: instances.id })
  return rows.length > 0
}

/** Background sweep: soft-delete unpaid BYOS installs whose Checkout has expired. */
export async function reapUnpaidByosInstalls(): Promise<number> {
  const cutoff = new Date(Date.now() - UNPAID_INSTALL_MAX_AGE_MS)
  const rows = await db
    .update(instances)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(and(isUnpaidByosInstall, lt(instances.createdAt, cutoff)))
    .returning({ id: instances.id })
  return rows.length
}
