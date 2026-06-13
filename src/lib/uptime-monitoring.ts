// High-level Uptime Kuma orchestration — the surface the rest of the app calls.
//
//   syncUptimeMonitor(id)   → create (or update) the agent's Kuma monitor
//   removeUptimeMonitor(id)  → delete it on teardown
//   runUptimeSync()          → poll /metrics, write the latest snapshot per row
//
// Design rules (all enforced here):
//   • When Kuma is unconfigured (env unset), every function early-returns. The
//     feature is fully dormant.
//   • These NEVER throw into their callers. Monitoring is best-effort
//     observability — it must not break provisioning, deletion, or a cron run.
//     Failures are logged (per-instance via logInstanceEvent, or collected into
//     the sync report) and swallowed.
//
// Mirrors the shape of src/lib/provider-health.ts (a sweep + a report).

import type { InferSelectModel } from "drizzle-orm"
import { db, instances, instanceUptimeSamples, eq, and, isNotNull, isNull, lt, sql } from "@/db"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { getRuntime, type RuntimeEngine } from "@/lib/runtimes"
import { logInstanceEvent } from "@/lib/instance-state"
import {
  getKumaEnv,
  addMonitor,
  editMonitor,
  deleteMonitor,
  fetchKumaMetrics,
  parseKumaMetrics,
  type KumaMonitorSnapshot,
} from "@/lib/uptime-kuma"

type Instance = InferSelectModel<typeof instances>

/**
 * The URL a Kuma HTTP monitor should probe: the agent's public gateway plus the
 * runtime's health path. Returns null when the agent isn't publicly reachable
 * yet (no domain / subdomain / IP) — caller no-ops.
 */
function buildMonitorUrl(instance: Instance, runtime: RuntimeEngine): string | null {
  const base = buildPublicGatewayUrl({
    domain: instance.domain,
    managedSubdomain: instance.managedSubdomain,
    tlsStatus: instance.tlsStatus,
    ipAddress: instance.ipAddress,
  })
  if (!base) return null

  // Shared-cluster agents have no Caddy/DNS: they're reached at the host IP on
  // their published container port, not 80/443. buildPublicGatewayUrl gives us
  // http://<ip> in that case, so swap in the real port.
  let origin = base.url
  if (!instance.domain && !instance.managedSubdomain && instance.containerPort && instance.ipAddress) {
    origin = `http://${instance.ipAddress}:${instance.containerPort}`
  }

  const path = runtime.healthPath || "/"
  return origin.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`)
}

/**
 * Create or update the Uptime Kuma monitor for an instance. Idempotent: edits
 * the existing monitor when `kumaMonitorId` is set, otherwise creates one and
 * persists the returned id. Safe to call repeatedly (e.g. whenever the public
 * URL changes — a custom domain is attached, TLS is issued, etc.).
 */
export async function syncUptimeMonitor(instanceId: string): Promise<void> {
  const env = getKumaEnv()
  if (!env) return

  let instance: Instance | undefined
  try {
    instance = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) })
  } catch {
    return
  }
  if (!instance) return

  const runtime = getRuntime(instance.runtime)
  const url = buildMonitorUrl(instance, runtime)
  if (!url) return // not publicly reachable yet — nothing to monitor

  const name = `${instance.name} (${instance.id})`
  const existingId = instance.kumaMonitorId

  try {
    if (existingId) {
      await editMonitor(env, { id: existingId, name, url })
    } else {
      const monitorId = await addMonitor(env, { name, url })
      await db.update(instances).set({ kumaMonitorId: monitorId }).where(eq(instances.id, instance.id))
    }
    await logInstanceEvent({
      instanceId,
      stage: "monitor",
      action: existingId ? "kuma_updated" : "kuma_created",
      result: "ok",
      message: existingId
        ? `Uptime Kuma monitor #${existingId} updated (${url}).`
        : `Uptime Kuma monitor created (${url}).`,
    })
  } catch (err) {
    await logInstanceEvent({
      instanceId,
      level: "warn",
      stage: "monitor",
      action: "kuma_sync",
      result: "error",
      message: `Uptime Kuma monitor sync failed (continuing): ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  }
}

/** Delete an instance's Kuma monitor (best-effort) and clear the stored id. */
export async function removeUptimeMonitor(instanceId: string): Promise<void> {
  const env = getKumaEnv()
  if (!env) return

  let instance: Pick<Instance, "id" | "kumaMonitorId"> | undefined
  try {
    instance = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
      columns: { id: true, kumaMonitorId: true },
    })
  } catch {
    return
  }
  if (!instance?.kumaMonitorId) return

  const monitorId = instance.kumaMonitorId
  try {
    await deleteMonitor(env, monitorId)
    await db.update(instances).set({ kumaMonitorId: null }).where(eq(instances.id, instanceId))
    await logInstanceEvent({
      instanceId,
      stage: "monitor",
      action: "kuma_deleted",
      result: "ok",
      message: `Uptime Kuma monitor #${monitorId} removed.`,
    })
  } catch (err) {
    await logInstanceEvent({
      instanceId,
      level: "warn",
      stage: "monitor",
      action: "kuma_delete",
      result: "error",
      message: `Uptime Kuma monitor delete failed (continuing): ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  }
}

export type UptimeSyncReport = {
  /** Instances with a Kuma monitor that we considered this run. */
  scanned: number
  /** Instances whose snapshot we matched in /metrics and updated. */
  matched: number
  errors: string[]
}

/**
 * Poll Kuma's /metrics, then write the latest status snapshot onto every
 * instance that has a monitor. Kuma does the actual probing on its own interval;
 * this just mirrors the current result into our DB for the dashboard to render.
 */
export async function runUptimeSync(): Promise<UptimeSyncReport> {
  const report: UptimeSyncReport = { scanned: 0, matched: 0, errors: [] }

  const env = getKumaEnv()
  if (!env) return report

  let snapshots
  try {
    snapshots = parseKumaMetrics(await fetchKumaMetrics(env))
  } catch (err) {
    report.errors.push(`metrics fetch: ${err instanceof Error ? err.message : String(err)}`)
    return report
  }

  const rows = await db.query.instances.findMany({
    where: and(isNotNull(instances.kumaMonitorId), sql`${instances.status} != 'deleted'`),
    columns: { id: true, kumaMonitorId: true },
  })

  // Some Kuma versions label /metrics by numeric monitor_id; others (seen in the
  // wild) only emit monitor_name. We name every monitor "<agent name> (<instance
  // id>)", so index snapshots by the trailing "(id)" pulled out of the name-keyed
  // entries. The numeric-id lookup below is tried first; this is the fallback that
  // makes name-only Kuma installs work, and it's rename-proof (matches on id).
  const byInstanceId = new Map<string, KumaMonitorSnapshot>()
  for (const [key, snap] of snapshots) {
    const m = key.match(/\(([^()]+)\)\s*$/)
    if (m) byInstanceId.set(m[1], snap)
  }

  const checkedAt = new Date()
  // Collected for the heartbeat-bar history; inserted in one batch after the loop.
  const samples: { instanceId: string; status: string | null; responseTimeMs: number | null; checkedAt: Date }[] = []
  for (const row of rows) {
    report.scanned++
    const snap = snapshots.get(String(row.kumaMonitorId)) ?? byInstanceId.get(row.id)
    if (!snap) continue // monitor exists but no metric line yet (just created)
    try {
      await db
        .update(instances)
        .set({
          kumaStatus: snap.status,
          kumaResponseTimeMs: snap.responseTimeMs,
          kumaUptimeRatio: snap.uptimeRatio,
          kumaCertDaysRemaining: snap.certDaysRemaining,
          kumaCheckedAt: checkedAt,
        })
        .where(eq(instances.id, row.id))
      samples.push({
        instanceId: row.id,
        status: snap.status,
        responseTimeMs: snap.responseTimeMs,
        checkedAt,
      })
      report.matched++
    } catch (err) {
      report.errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Append the heartbeat history, then prune anything past the retention window.
  // Best-effort: a failure here must not fail the snapshot sync above.
  if (samples.length > 0) {
    try {
      await db.insert(instanceUptimeSamples).values(samples)
      const cutoff = new Date(checkedAt.getTime() - SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      await db.delete(instanceUptimeSamples).where(lt(instanceUptimeSamples.checkedAt, cutoff))
    } catch (err) {
      report.errors.push(`samples: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return report
}

/** Heartbeat-history retention. Bars only ever render the most recent ~50; this
 *  just bounds table growth. */
const SAMPLE_RETENTION_DAYS = 7

// ──────────────────────────────────────────────────────────────────────
// Backfill — create monitors for already-running agents that never got one.
// ──────────────────────────────────────────────────────────────────────
//
// syncUptimeMonitor only fires once, at deploy time (provisioner.ts). So any
// agent that was already running before this feature shipped — or that was
// deployed while Kuma was unconfigured — has kumaMonitorId = null and would
// never appear on the dashboard. This sweep heals that: it's what makes uptime
// work for users who *already had* agents, not just freshly deployed ones.

/** Max monitors to create per run, so a large fleet can't cause a socket storm
 *  (each create opens a short-lived socket). Remaining agents are picked up on
 *  subsequent runs. */
const BACKFILL_LIMIT = 25

export type UptimeBackfillReport = {
  /** Running agents found without a monitor this run (capped at BACKFILL_LIMIT). */
  pending: number
  /** How many we ran syncUptimeMonitor against (it no-ops if not yet reachable). */
  attempted: number
  errors: string[]
}

/**
 * Find running agents with no Kuma monitor and create one for each. Idempotent:
 * syncUptimeMonitor persists the new monitor id, and no-ops for agents that
 * aren't publicly reachable yet (retried next run). Bounded per run, best-effort
 * — never throws into the caller.
 */
export async function ensureUptimeMonitors(): Promise<UptimeBackfillReport> {
  const report: UptimeBackfillReport = { pending: 0, attempted: 0, errors: [] }
  if (!getKumaEnv()) return report

  let rows: { id: string }[]
  try {
    rows = await db.query.instances.findMany({
      where: and(eq(instances.status, "running"), isNull(instances.kumaMonitorId)),
      columns: { id: true },
      limit: BACKFILL_LIMIT,
    })
  } catch (err) {
    report.errors.push(`backfill query: ${err instanceof Error ? err.message : String(err)}`)
    return report
  }

  report.pending = rows.length
  for (const row of rows) {
    try {
      await syncUptimeMonitor(row.id)
      report.attempted++
    } catch (err) {
      report.errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return report
}

// ──────────────────────────────────────────────────────────────────────
// Self-driving sync — so the dashboard works with zero operator cron wiring.
// ──────────────────────────────────────────────────────────────────────

let lastSelfSyncAt = 0
let selfSyncInFlight: Promise<unknown> | null = null
const SELF_SYNC_MIN_INTERVAL_MS = 60_000

/**
 * Best-effort: kick a /metrics sync if Kuma is configured and we haven't synced
 * in ~60s. Safe to await on every monitoring page render — it never throws, is
 * de-duped across concurrent requests (single in-flight promise), and is bounded
 * by the fetch timeout in fetchKumaMetrics so it can't wedge a render. The app
 * runs as a single pm2 fork, so this module-level throttle holds process-wide.
 *
 * A real cron (scripts/cron-tick.sh) is still recommended for fresh badges when
 * nobody is viewing the dashboard — this just removes the hard dependency on it.
 */
export async function maybeRunUptimeSync(): Promise<void> {
  if (!getKumaEnv()) return
  if (selfSyncInFlight) {
    await selfSyncInFlight.catch(() => {})
    return
  }
  if (Date.now() - lastSelfSyncAt < SELF_SYNC_MIN_INTERVAL_MS) return
  lastSelfSyncAt = Date.now()
  // Backfill missing monitors in the background — socket writes are slow, and a
  // freshly created monitor has no metrics for ~60s anyway, so there's nothing to
  // block the render on. Newly created monitors surface on a later sync.
  void ensureUptimeMonitors().catch(() => {})
  selfSyncInFlight = runUptimeSync()
    .catch(() => {})
    .finally(() => {
      selfSyncInFlight = null
    })
  await selfSyncInFlight
}
