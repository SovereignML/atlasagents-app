// Dashboard Overview time-series — the REAL data behind the four charts on
// /dashboard. Follows the direct-drizzle-in-server-component pattern (see
// src/lib/monitoring.ts): the page calls these with the signed-in user's id and
// renders the result. Nothing here is synthesized — an account with no agents /
// no spend / no uptime history yields empty arrays, and the charts show their
// zero state.
//
// Scoping mirrors monitoring.ts / page.tsx:
//   - runs + latency are scoped to the user's VISIBLE instances
//     (whereUserInstancesVisible), then constrained with inArray(...) on the id
//     set. `inArray([])` is invalid SQL, so each query short-circuits to [] when
//     the user has no instances.
//   - daily spend is scoped to the user's wallet. The real per-day compute debit
//     lives in WalletTransaction (type='daily_compute', written by
//     deductWithinTx via src/lib/daily-billing.ts) — CreditLedger is never
//     written in this codebase — so we sum those negative `amount`s and return
//     them as positive credits.

import {
  db,
  instances,
  agentEvents,
  instanceUptimeSamples,
  wallets,
  walletTransactions,
  and,
  eq,
  gte,
  inArray,
  sql,
} from "@/db"
import { whereUserInstancesVisible } from "@/lib/instance-queries"

/** Resolve the ids of every instance the user can see (same rule as the page). */
async function visibleInstanceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: instances.id })
    .from(instances)
    .where(whereUserInstancesVisible(userId))
  return rows.map((r) => r.id)
}

/**
 * Runs per day — count of `run.finished` AgentEvents across the user's
 * instances, grouped by calendar day, over the last `days` days, ascending and
 * zero-filled so the bar chart has one bar per day even on quiet days.
 */
export async function getRunsPerDay(
  userId: string,
  days = 14,
): Promise<{ day: string; runs: number }[]> {
  const ids = await visibleInstanceIds(userId)
  // Build the zero-filled day skeleton first (UTC day buckets), oldest→newest.
  const skeleton: { day: string; runs: number }[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    skeleton.push({ day: d.toISOString().slice(0, 10), runs: 0 })
  }
  if (ids.length === 0) return skeleton

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${agentEvents.createdAt}), 'YYYY-MM-DD')`,
      runs: sql<number>`count(*)::int`,
    })
    .from(agentEvents)
    .where(
      and(
        inArray(agentEvents.instanceId, ids),
        eq(agentEvents.type, "run.finished"),
        gte(agentEvents.createdAt, since),
      ),
    )
    .groupBy(sql`date_trunc('day', ${agentEvents.createdAt})`)

  const byDay = new Map(rows.map((r) => [r.day, Number(r.runs)]))
  return skeleton.map((s) => ({ day: s.day, runs: byDay.get(s.day) ?? 0 }))
}

/**
 * Daily spend — sum of the user's `daily_compute` debits, grouped by calendar
 * day over the last `days` days, returned as POSITIVE credit amounts (the stored
 * `amount` is negative). Scoped to the user's wallet via a join. Returns only
 * the days that have spend, ascending — the chart renders an empty state if
 * there are none.
 */
export async function getDailySpend(
  userId: string,
  days = 7,
): Promise<{ day: string; credits: number }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${walletTransactions.createdAt}), 'YYYY-MM-DD')`,
      credits: sql<number>`coalesce(-sum(${walletTransactions.amount}), 0)::int`,
    })
    .from(walletTransactions)
    .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
    .where(
      and(
        eq(wallets.userId, userId),
        eq(walletTransactions.type, "daily_compute"),
        gte(walletTransactions.createdAt, since),
      ),
    )
    .groupBy(sql`date_trunc('day', ${walletTransactions.createdAt})`)
    .orderBy(sql`date_trunc('day', ${walletTransactions.createdAt})`)

  return rows.map((r) => ({ day: r.day, credits: Number(r.credits) }))
}

/**
 * Average latency over the last `hours` hours — mean `responseTimeMs` from the
 * user's InstanceUptimeSample rows (status 'up', responseTime present), grouped
 * by hour, ascending. Mirrors the heartbeat-history source in monitoring.ts.
 */
export async function getLatencySeries(
  userId: string,
  hours = 24,
): Promise<{ t: string; ms: number }[]> {
  const ids = await visibleInstanceIds(userId)
  if (ids.length === 0) return []

  const since = new Date(Date.now() - hours * 60 * 60 * 1000)
  const rows = await db
    .select({
      t: sql<string>`to_char(date_trunc('hour', ${instanceUptimeSamples.checkedAt}), 'YYYY-MM-DD"T"HH24:00')`,
      ms: sql<number>`round(avg(${instanceUptimeSamples.responseTimeMs}))::int`,
    })
    .from(instanceUptimeSamples)
    .where(
      and(
        inArray(instanceUptimeSamples.instanceId, ids),
        eq(instanceUptimeSamples.status, "up"),
        sql`${instanceUptimeSamples.responseTimeMs} is not null`,
        gte(instanceUptimeSamples.checkedAt, since),
      ),
    )
    .groupBy(sql`date_trunc('hour', ${instanceUptimeSamples.checkedAt})`)
    .orderBy(sql`date_trunc('hour', ${instanceUptimeSamples.checkedAt})`)

  return rows.map((r) => ({ t: r.t, ms: Number(r.ms) }))
}
