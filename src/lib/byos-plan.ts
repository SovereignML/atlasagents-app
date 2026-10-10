// BYOS plans: bought per connected server, independently of installing agents.
//
// Connecting a server is free. A BYOS plan is a recurring subscription bought
// FOR one connected server (Subscription.byosServerId, no instanceId), and it
// is what lets the team install agents onto that server — as many as it holds.
// Installing never opens a checkout; it only checks for a plan.
//
// Legacy rows: before this, every BYOS install opened its own subscription,
// tied to the agent (Subscription.instanceId). Those still count as a plan for
// the server their agent sits on, so nobody who already pays has to buy again.
//
// Pure rules (which statuses count, which row wins) are in byos-install.ts.

import { db, byosServers, instances, subscriptions, and, eq, inArray, ne } from "@/db"
import { LIVE_PLAN_STATUS_LIST, pickBestPlan, planIsLive } from "@/lib/byos-install"
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
  /** A pre-split per-agent subscription, not a per-server plan. */
  legacy: boolean
}

const planColumns = {
  id: subscriptions.id,
  stripeSubscriptionId: subscriptions.stripeSubscriptionId,
  status: subscriptions.status,
  interval: subscriptions.interval,
  currentPeriodEnd: subscriptions.currentPeriodEnd,
  cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
  createdAt: subscriptions.createdAt,
}

type PlanRow = {
  id: string
  stripeSubscriptionId: string | null
  status: string
  interval: string
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  createdAt: Date
}

function toPlan(row: PlanRow, legacy: boolean): ByosPlan {
  return {
    subscriptionId: row.id,
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status,
    interval: row.interval,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt,
    legacy,
  }
}

/**
 * The live plan covering each of these servers. Servers with no live plan are
 * absent from the map. Two queries regardless of how many servers.
 */
export async function findByosPlans(serverIds: string[]): Promise<Map<string, ByosPlan>> {
  const out = new Map<string, ByosPlan>()
  if (serverIds.length === 0) return out

  const [direct, legacy] = await Promise.all([
    db
      .select({ ...planColumns, serverId: subscriptions.byosServerId })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.byosServerId, serverIds),
          inArray(subscriptions.status, LIVE_PLAN_STATUS_LIST),
        ),
      ),
    // Per-agent subscriptions from before the split, reached through the agent.
    db
      .select({ ...planColumns, serverId: instances.byosServerId })
      .from(subscriptions)
      .innerJoin(instances, eq(subscriptions.instanceId, instances.id))
      .where(
        and(
          inArray(instances.byosServerId, serverIds),
          ne(instances.status, "deleted"),
          inArray(subscriptions.status, LIVE_PLAN_STATUS_LIST),
        ),
      ),
  ])

  const candidates = new Map<string, ByosPlan[]>()
  for (const [rows, isLegacy] of [
    [direct, false],
    [legacy, true],
  ] as const) {
    for (const row of rows) {
      if (!row.serverId) continue
      const list = candidates.get(row.serverId) ?? []
      list.push(toPlan(row, isLegacy))
      candidates.set(row.serverId, list)
    }
  }
  for (const [serverId, list] of candidates) {
    const best = pickBestPlan(list)
    if (best) out.set(serverId, best)
  }
  return out
}

export async function findByosPlan(serverId: string): Promise<ByosPlan | null> {
  return (await findByosPlans([serverId])).get(serverId) ?? null
}

/**
 * A server's plan has ended: stop its running agents, unless another live plan
 * still covers the server (a double purchase, or a legacy per-agent row).
 *
 * Stopping, not deleting — the agents and their data stay on the customer's
 * machine, and they start again from the agent page once a plan is back. Called
 * from customer.subscription.deleted, which Stripe sends at the END of the paid
 * period for a cancel, so agents run through every month that was paid for.
 */
export async function stopAgentsOnUncoveredServer(serverId: string): Promise<number> {
  if (await findByosPlan(serverId)) return 0

  const server = await db.query.byosServers.findFirst({
    where: eq(byosServers.id, serverId),
    columns: { id: true, label: true, userId: true },
  })
  const running = await db.query.instances.findMany({
    where: and(eq(instances.byosServerId, serverId), eq(instances.status, "running")),
  })
  if (running.length === 0) return 0

  const { pauseBot } = await import("@/lib/provisioner")
  let stopped = 0
  for (const instance of running) {
    try {
      await pauseBot(instance)
      stopped++
    } catch (err) {
      console.warn(`[byos-plan] pauseBot failed for ${instance.id}:`, err)
    }
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "subscription",
      action: "byos_plan_ended",
      message: "The BYOS plan for this server ended, so the agent was stopped.",
    })
  }

  const ownerId = server?.userId ?? running[0].userId
  const label = server?.label ?? running[0].byosHost ?? "your server"
  await notify({
    userId: ownerId,
    category: "billing",
    type: "byos_plan_ended",
    title: `BYOS plan ended for ${label}`,
    message: `The BYOS plan for ${label} has ended, so ${running.length === 1 ? "its agent was" : `its ${running.length} agents were`} stopped. Nothing on the server was deleted — buy a plan for it again to start ${running.length === 1 ? "it" : "them"}.`,
    url: "/dashboard/byos",
  })
  return stopped
}

/** Whether a BYOS agent is allowed to run right now (its server has a live plan). */
export async function byosAgentIsCovered(instance: {
  deploymentTarget: string | null
  byosServerId: string | null
}): Promise<boolean> {
  if (instance.deploymentTarget !== "byos" || !instance.byosServerId) return true
  const plan = await findByosPlan(instance.byosServerId)
  return planIsLive(plan?.status)
}
