// Server hardware metrics collector — the real box behind each instance, probed
// over SSH (RAM, CPU cores + load, disk, OS, uptime) and mirrored onto the hw*
// columns of `instances` for the dashboard to render.
//
// Mirrors the shape of src/lib/uptime-monitoring.ts (a sweep + a report): one
// probe per running instance, per-row errors collected rather than thrown, a
// rolling ServerMetricSample history pruned to a retention window.
//
// Design rules:
//   • Best-effort: this must never throw into a cron run or a page. A probe that
//     fails marks the instance hwHealth="unreachable" (with hwError) and leaves
//     the last-known specs intact.
//   • The probe reads only unprivileged paths (/proc, /etc/os-release, df /), so
//     no sudo elevation is needed — cheaper, and works for non-root BYOS users.

import type { InferSelectModel } from "drizzle-orm"
import { db, instances, serverMetricSamples, and, eq, isNotNull, lt, sql } from "@/db"
import { sshTargetForInstance } from "@/lib/ssh-target"
import { sshRunScript, type SshTarget } from "@/lib/ssh"
import {
  PROBE_SCRIPT,
  parseServerMetrics,
  type ServerMetricSnapshot,
} from "@/lib/server-metrics-parse"

export { parseServerMetrics, type ServerMetricSnapshot }

type Instance = InferSelectModel<typeof instances>

/** Days of ServerMetricSample history to keep; older rows are pruned each run. */
const SAMPLE_RETENTION_DAYS = 7

/** Per-instance probe timeout — fail fast so one unreachable host can't stall a sweep. */
const PROBE_TIMEOUT_MS = 15_000

/**
 * Build the SSH target for a metrics probe. Mirrors sshTargetFor in
 * provisioner.ts but replicated here to avoid importing the (heavy) provisioner
 * module graph into the cron/route path. BYOS servers may use a custom
 * port/user; managed VPS connect as root:22. `instanceId` enables TOFU host-key
 * pinning against instances.sshHostFingerprint.
 */
function targetFor(instance: Instance): SshTarget {
  return sshTargetForInstance(instance)
}

async function probe(instance: Instance): Promise<ServerMetricSnapshot> {
  const res = await sshRunScript(targetFor(instance), PROBE_SCRIPT, { timeoutMs: PROBE_TIMEOUT_MS })
  if (res.code !== 0) {
    throw new Error(`probe exited ${res.code}: ${(res.stderr || res.stdout || "").trim()}`.slice(0, 500))
  }
  return parseServerMetrics(res.stdout)
}

async function writeSnapshot(instanceId: string, snap: ServerMetricSnapshot, checkedAt: Date) {
  await db
    .update(instances)
    .set({
      hwCpuCores: snap.cpuCores,
      hwCpuLoad1: snap.cpuLoad1,
      hwRamTotalMb: snap.ramTotalMb,
      hwRamUsedMb: snap.ramUsedMb,
      hwDiskTotalGb: snap.diskTotalGb,
      hwDiskUsedGb: snap.diskUsedGb,
      hwOsName: snap.osName,
      hwOsVersion: snap.osVersion,
      hwKernel: snap.kernel,
      hwUptimeSec: snap.uptimeSec,
      hwHealth: "reachable",
      hwCheckedAt: checkedAt,
      hwError: null,
    })
    .where(eq(instances.id, instanceId))
}

async function writeFailure(instanceId: string, message: string, checkedAt: Date) {
  // Leave the last-known hw* specs untouched — only flip health + stamp the error.
  await db
    .update(instances)
    .set({ hwHealth: "unreachable", hwCheckedAt: checkedAt, hwError: message.slice(0, 500) })
    .where(eq(instances.id, instanceId))
}

export type ServerMetricsReport = {
  /** Running instances with a reachable host that we considered this run. */
  scanned: number
  /** Instances we successfully probed and updated. */
  matched: number
  errors: string[]
}

/**
 * Probe every running VPS/BYOS instance, mirror the snapshot onto its hw*
 * columns, append a ServerMetricSample, and prune old samples. Best-effort:
 * per-instance failures are recorded (both in the DB and the report) and never
 * abort the sweep.
 */
export async function collectServerMetrics(): Promise<ServerMetricsReport> {
  const report: ServerMetricsReport = { scanned: 0, matched: 0, errors: [] }

  const rows = await db.query.instances.findMany({
    where: and(
      eq(instances.status, "running"),
      isNotNull(instances.ipAddress),
      sql`${instances.deploymentTarget} IN ('vps', 'byos')`,
    ),
  })

  const checkedAt = new Date()
  const samples: { instanceId: string; cpuLoad1: number | null; ramUsedMb: number | null; checkedAt: Date }[] = []

  for (const instance of rows) {
    report.scanned++
    try {
      const snap = await probe(instance)
      await writeSnapshot(instance.id, snap, checkedAt)
      samples.push({ instanceId: instance.id, cpuLoad1: snap.cpuLoad1, ramUsedMb: snap.ramUsedMb, checkedAt })
      report.matched++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      report.errors.push(`${instance.id}: ${message}`)
      try {
        await writeFailure(instance.id, message, checkedAt)
      } catch (writeErr) {
        report.errors.push(
          `${instance.id} (write): ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
        )
      }
    }
  }

  // Append history, then prune past the retention window. Best-effort: a failure
  // here must not fail the snapshot updates above.
  if (samples.length > 0) {
    try {
      await db.insert(serverMetricSamples).values(samples)
      const cutoff = new Date(checkedAt.getTime() - SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      await db.delete(serverMetricSamples).where(lt(serverMetricSamples.checkedAt, cutoff))
    } catch (err) {
      report.errors.push(`samples: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return report
}

export type OneServerMetricResult = {
  health: "reachable" | "unreachable"
  snapshot: ServerMetricSnapshot | null
  error: string | null
  checkedAt: Date
}

/**
 * Probe a single instance on demand (the "Refresh" button). Writes the same
 * columns as the sweep and returns the fresh result. Throws only if the instance
 * can't be probed at all (missing/invalid target) — a reachable-but-failed probe
 * returns health "unreachable" with the error, matching the sweep's semantics.
 */
export async function collectOneServerMetric(instanceId: string): Promise<OneServerMetricResult> {
  const instance = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) })
  if (!instance) throw new Error("instance not found")
  if (!instance.ipAddress && !instance.byosHost) throw new Error("instance has no server host yet")

  const checkedAt = new Date()
  try {
    const snapshot = await probe(instance)
    await writeSnapshot(instance.id, snapshot, checkedAt)
    try {
      await db.insert(serverMetricSamples).values({
        instanceId: instance.id,
        cpuLoad1: snapshot.cpuLoad1,
        ramUsedMb: snapshot.ramUsedMb,
        checkedAt,
      })
    } catch {
      // history is best-effort — ignore
    }
    return { health: "reachable", snapshot, error: null, checkedAt }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeFailure(instance.id, message, checkedAt)
    return { health: "unreachable", snapshot: null, error: message.slice(0, 500), checkedAt }
  }
}
