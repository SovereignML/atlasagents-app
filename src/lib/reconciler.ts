// Reconciliation worker. Runs periodically (cron or admin-triggered) to
// ensure DB state matches actual provider state. The reconciler is the
// orphan-prevention backstop for crashes, missed webhooks, and partial
// delete failures.
//
// Six passes, each logged independently so operators can see what ran:
//
//   1. Orphan sweep       — VMs in provider not owned by any DB row → delete.
//   2. Deleting retries   — rows in `deleting` whose VM still exists → retry.
//   3. Failed cleanups    — rows in `failed_provisioning` with a vmId → delete VM.
//   4. Stuck provisioning — rows in `provisioning` older than TTL → rollback.
//   5. DB confirmation    — rows in `deleting` whose VM is gone → mark deleted.
//   6. Stamp reconciledAt — every instance row touched.

import {
  db,
  instances,
  orphanEvents,
  eq,
  and,
  isNotNull,
  inArray,
  sql,
} from "@/db"
import { getVmProvider, describeVmError } from "@/lib/vm-provider"
import { logInstanceEvent, transitionInstance } from "@/lib/instance-state"

const ORPHAN_GRACE_MS = 15 * 60 * 1000 // 15 minutes — gives in-flight creates room to commit
const PROVISIONING_TTL_MS = 20 * 60 * 1000 // 20 minutes
const TAG = "sovereignml"

type ReconcileReport = {
  orphansDetected: number
  orphansDeleted: number
  deletingRetried: number
  deletingCompleted: number
  failedCleanups: number
  stuckProvisioning: number
  errors: string[]
}

export async function runReconciler(): Promise<ReconcileReport> {
  const provider = await getVmProvider()
  const report: ReconcileReport = {
    orphansDetected: 0,
    orphansDeleted: 0,
    deletingRetried: 0,
    deletingCompleted: 0,
    failedCleanups: 0,
    stuckProvisioning: 0,
    errors: [],
  }

  // Collect DB-owned vmIds for fast lookup. A row counts as "owning" its
  // vmId unless it's in `deleted` state.
  const owned = await db.query.instances.findMany({
    where: and(
      isNotNull(instances.vmId),
      sql`${instances.status} != 'deleted'`,
    ),
    columns: { id: true, status: true, vmId: true, createdAt: true, lastTransitionAt: true },
  })
  const ownedIds = new Set<string>(owned.map((r) => r.vmId!).filter(Boolean))

  // ─────────────────────────────────────────────────────────────────────
  // Pass 1: Orphan sweep — anything in provider tagged "sovereignml" with
  // no matching DB row AND older than the grace period → delete.
  // ─────────────────────────────────────────────────────────────────────
  let providerVms: Awaited<ReturnType<typeof provider.listVMs>> = []
  try {
    providerVms = await provider.listVMs({ tag: TAG })
  } catch (err) {
    report.errors.push(`listVMs: ${await describeVmError(err)}`)
  }

  const now = Date.now()
  for (const vm of providerVms) {
    if (ownedIds.has(vm.id)) continue
    const createdMs = vm.created ? Date.parse(vm.created) : now
    if (now - createdMs < ORPHAN_GRACE_MS) continue

    report.orphansDetected++
    const [detected] = await db
      .insert(orphanEvents)
      .values({
        vmId: vm.id,
        action: "detected",
        detail: `label=${vm.label ?? ""}; createdAt=${vm.created ?? ""}`,
      })
      .returning()

    try {
      const deleted = await provider.deleteVM(vm.id)
      report.orphansDeleted += deleted ? 1 : 0
      await db
        .update(orphanEvents)
        .set({
          action: deleted ? "deleted" : "already_gone",
          resolvedAt: new Date(),
        })
        .where(eq(orphanEvents.id, detected.id))
    } catch (err) {
      const msg = await describeVmError(err)
      report.errors.push(`orphan ${vm.id}: ${msg}`)
      await db
        .update(orphanEvents)
        .set({ action: "failed", resolvedAt: new Date(), detail: msg })
        .where(eq(orphanEvents.id, detected.id))
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Pass 2+5: Rows in `deleting` — retry delete, or confirm deletion.
  // ─────────────────────────────────────────────────────────────────────
  const deletingRows = owned.filter((r) => r.status === "deleting")
  for (const row of deletingRows) {
    if (!row.vmId) continue
    try {
      const vm = await provider.getVMOrNull(row.vmId)
      if (!vm) {
        await transitionInstance(row.id, ["deleting"], "deleted", {
          set: { vmId: null, ipAddress: null },
        })
        report.deletingCompleted++
        await logInstanceEvent({
          instanceId: row.id,
          stage: "reconcile",
          action: "delete_confirmed",
          result: "ok",
          message: "Reconciler confirmed VM is gone; instance marked deleted.",
        })
      } else {
        await provider.deleteVM(row.vmId)
        report.deletingRetried++
        await logInstanceEvent({
          instanceId: row.id,
          stage: "reconcile",
          action: "delete_retry",
          result: "ok",
          message: `Reconciler retried deleteVM(${row.vmId}).`,
        })
      }
    } catch (err) {
      const msg = await describeVmError(err)
      report.errors.push(`deleting ${row.id}: ${msg}`)
      await logInstanceEvent({
        instanceId: row.id,
        level: "error",
        stage: "reconcile",
        action: "delete_retry",
        result: "error",
        message: `Reconciler delete retry failed: ${msg}`,
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Pass 3: failed_provisioning rows that still have a vmId.
  // ─────────────────────────────────────────────────────────────────────
  const failedRows = owned.filter(
    (r) => r.status === "failed_provisioning" && r.vmId != null,
  )
  for (const row of failedRows) {
    try {
      const deleted = await provider.deleteVM(row.vmId!)
      report.failedCleanups += deleted ? 1 : 0
      await db
        .update(instances)
        .set({ vmId: null, ipAddress: null })
        .where(eq(instances.id, row.id))
      await logInstanceEvent({
        instanceId: row.id,
        stage: "reconcile",
        action: "failed_cleanup",
        result: "ok",
        message: `Reconciler cleaned orphan VM ${row.vmId} for failed instance.`,
      })
    } catch (err) {
      const msg = await describeVmError(err)
      report.errors.push(`failed ${row.id}: ${msg}`)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Pass 4: Stuck `provisioning` rows — crash recovery.
  // ─────────────────────────────────────────────────────────────────────
  const provisioningRows = owned.filter((r) => r.status === "provisioning")
  for (const row of provisioningRows) {
    const stamp = row.lastTransitionAt ?? row.createdAt
    if (!stamp) continue
    if (now - stamp.getTime() < PROVISIONING_TTL_MS) continue

    report.stuckProvisioning++
    let vmDeleted = false
    if (row.vmId) {
      try {
        vmDeleted = await provider.deleteVM(row.vmId)
      } catch (err) {
        report.errors.push(`stuck ${row.id}: ${await describeVmError(err)}`)
      }
    }
    try {
      await transitionInstance(row.id, ["provisioning"], "failed_provisioning", {
        error: "timed out — reclaimed by reconciler",
        set: vmDeleted ? { vmId: null, ipAddress: null } : {},
      })
      await logInstanceEvent({
        instanceId: row.id,
        level: "warn",
        stage: "reconcile",
        action: "stuck_provisioning_reclaimed",
        result: vmDeleted ? "ok" : "error",
        detail: { vmId: row.vmId, vmDeleted },
        message: `Stuck provisioning row reclaimed after ${PROVISIONING_TTL_MS / 60000}min TTL.`,
      })
    } catch (err) {
      report.errors.push(`transition ${row.id}: ${(err as Error).message}`)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Pass 6: stamp reconciledAt on everything we looked at.
  // ─────────────────────────────────────────────────────────────────────
  if (owned.length > 0) {
    await db
      .update(instances)
      .set({ reconciledAt: new Date() })
      .where(
        inArray(
          instances.id,
          owned.map((r) => r.id),
        ),
      )
  }

  console.log(
    JSON.stringify({
      kind: "reconcile_report",
      provider: provider.name,
      ...report,
      scannedProviderVMs: providerVms.length,
      scannedDbRows: owned.length,
    }),
  )
  return report
}
