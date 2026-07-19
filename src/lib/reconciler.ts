// Reconciliation worker. Runs periodically (cron or admin-triggered) to
// ensure DB state matches actual provider state. The reconciler is the
// orphan-prevention backstop for crashes, missed webhooks, and partial
// delete failures.
//
// Seven passes, each logged independently so operators can see what ran:
//
//   1. Orphan sweep       — VMs in provider not owned by any DB row → delete.
//   2. Deleting retries   — rows in `deleting` whose VM still exists → retry.
//   3. Failed cleanups    — rows in `failed_provisioning` with a vmId → delete VM.
//   4. Stuck provisioning — rows in `provisioning` older than TTL → rollback.
//   5. DB confirmation    — rows in `deleting` whose VM is gone → mark deleted.
//   6. Stamp reconciledAt — every instance row touched.
//   7. OpenRouter keys — revoke orphans (deleted/missing instances) and
//      self-heal spend-cap drift on live instances' keys.

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
import { describeVmError } from "@/lib/vm-provider"
import { getVmProviderById, getAllEnabledProviders } from "@/lib/providers"
import { getWarmVmIds } from "@/lib/warm-pool"
import { logInstanceEvent, transitionInstance } from "@/lib/instance-state"
import {
  listRuntimeKeys,
  revokeRuntimeKey,
  updateRuntimeKey,
} from "@/lib/openrouter-provisioning"
import { getTenantOpenRouterKey } from "@/lib/tenant"
import { reconcilePendingCustomHostnames } from "@/lib/tenant-branding"

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
  /** OpenRouter runtime keys revoked: deleted-instance rows + unlabelled-on-OR-side orphans. */
  openRouterKeysRevoked: number
  /** OpenRouter keys whose spend cap drifted from our intended value and was re-PATCHed. */
  openRouterLimitsHealed: number
  /** White-label custom domains whose CF cert went active and were marked verified. */
  customHostnamesVerified: number
  errors: string[]
}

const OR_LABEL_PREFIX = "sovereign-"

export async function runReconciler(): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    orphansDetected: 0,
    orphansDeleted: 0,
    deletingRetried: 0,
    deletingCompleted: 0,
    failedCleanups: 0,
    stuckProvisioning: 0,
    openRouterKeysRevoked: 0,
    openRouterLimitsHealed: 0,
    customHostnamesVerified: 0,
    errors: [],
  }

  // Collect DB-owned vmIds for fast lookup, partitioned by the provider that
  // owns each VM. A row counts as "owning" its vmId unless it's `deleted`.
  // Legacy/shared rows have a null providerId — bucket them under "" and treat
  // them as Linode (the env-default provider) during the orphan sweep.
  const owned = await db.query.instances.findMany({
    where: and(
      isNotNull(instances.vmId),
      sql`${instances.status} != 'deleted'`,
    ),
    columns: {
      id: true,
      status: true,
      vmId: true,
      providerId: true,
      ipAddress: true,
      createdAt: true,
      lastTransitionAt: true,
    },
  })
  const ownedByProvider = new Map<string, Set<string>>()
  for (const r of owned) {
    if (!r.vmId) continue
    const key = r.providerId ?? ""
    const set = ownedByProvider.get(key) ?? new Set<string>()
    set.add(r.vmId)
    ownedByProvider.set(key, set)
  }

  // Which providers to sweep. Falls back to env-default Linode when no
  // providers are seeded yet (preserves pre-multi-provider behaviour).
  let sweepTargets = await getAllEnabledProviders()
  if (sweepTargets.length === 0) {
    sweepTargets = [
      { providerId: "", slug: "linode", name: "Linode", provider: await getVmProviderById(null) },
    ]
  }
  // Warm pool VMs are live (or in-flight) but owned by no instance row until
  // claimed. Without this they'd match the orphan sweep and the pool would
  // self-destruct — so treat every tracked pool vmId as owned on every provider.
  const warmVmIds = await getWarmVmIds()
  const ownedSetFor = (t: (typeof sweepTargets)[number]): Set<string> => {
    const set = new Set<string>(ownedByProvider.get(t.providerId) ?? [])
    // null/legacy VMs live on Linode.
    if (t.slug === "linode") for (const v of ownedByProvider.get("") ?? []) set.add(v)
    for (const v of warmVmIds) set.add(v)
    return set
  }

  const now = Date.now()
  let scannedProviderVMs = 0

  // ─────────────────────────────────────────────────────────────────────
  // Pass 1: Orphan sweep — per provider, anything tagged "sovereignml" with
  // no matching DB row AND older than the grace period → delete.
  // ─────────────────────────────────────────────────────────────────────
  for (const target of sweepTargets) {
    const ownedIds = ownedSetFor(target)
    let providerVms: Awaited<ReturnType<typeof target.provider.listVMs>> = []
    try {
      providerVms = await target.provider.listVMs({ tag: TAG })
    } catch (err) {
      report.errors.push(`listVMs[${target.slug}]: ${await describeVmError(err)}`)
      continue
    }
    scannedProviderVMs += providerVms.length

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
          ipAddress: vm.ipv4?.[0] ?? null,
          detail: `provider=${target.slug}; label=${vm.label ?? ""}; createdAt=${vm.created ?? ""}`,
        })
        .returning()

      try {
        const deleted = await target.provider.deleteVM(vm.id)
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
        report.errors.push(`orphan ${target.slug}/${vm.id}: ${msg}`)
        await db
          .update(orphanEvents)
          .set({ action: "failed", resolvedAt: new Date(), detail: msg })
          .where(eq(orphanEvents.id, detected.id))
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Pass 2+5: Rows in `deleting` — retry delete, or confirm deletion.
  // ─────────────────────────────────────────────────────────────────────
  const deletingRows = owned.filter((r) => r.status === "deleting")
  for (const row of deletingRows) {
    if (!row.vmId) continue
    try {
      const provider = await getVmProviderById(row.providerId)
      const vm = await provider.getVMOrNull(row.vmId)
      if (!vm) {
        await transitionInstance(row.id, ["deleting"], "deleted", {
          set: { vmId: null, ipAddress: null, deletedIpAddress: row.ipAddress ?? null },
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
      const provider = await getVmProviderById(row.providerId)
      const deleted = await provider.deleteVM(row.vmId!)
      report.failedCleanups += deleted ? 1 : 0
      // Record the released IP. A later retry/reprovision overwrites `ipAddress`
      // but leaves `deletedIpAddress` as the last IP this row released.
      await db
        .update(instances)
        .set({ vmId: null, ipAddress: null, deletedIpAddress: row.ipAddress ?? null })
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
        const provider = await getVmProviderById(row.providerId)
        vmDeleted = await provider.deleteVM(row.vmId)
      } catch (err) {
        report.errors.push(`stuck ${row.id}: ${await describeVmError(err)}`)
      }
    }
    try {
      await transitionInstance(row.id, ["provisioning"], "failed_provisioning", {
        error: "timed out — reclaimed by reconciler",
        // Retain the released IP when we actually destroyed the VM (see Pass 3).
        set: vmDeleted
          ? { vmId: null, ipAddress: null, deletedIpAddress: row.ipAddress ?? null }
          : {},
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
  // Pass 7: orphan OpenRouter runtime keys.
  //
  // Two failure modes this catches:
  //   (a) Instance was deleted but the inline revoke in deleteBot failed
  //       (network blip, OpenRouter 5xx). The row has status=deleted and
  //       still holds openRouterKeyId. Revoke and clear.
  //   (b) An OpenRouter-side key of ours (label prefix `sovereign-`, case-
  //       insensitive) whose keyId matches no non-deleted instance row
  //       (hard-deleted instance, dev cleanup, etc.). Revoke.
  //
  // Skipped silently if OPENROUTER_PROVISIONING_KEY is not set — keeps the
  // reconciler usable for fleets that haven't enabled per-instance keys yet.
  // ─────────────────────────────────────────────────────────────────────
  if (process.env.OPENROUTER_PROVISIONING_KEY) {
    // (a) Instance rows with leftover keyId after deletion.
    const leftover = await db.query.instances.findMany({
      where: and(
        eq(instances.status, "deleted"),
        isNotNull(instances.openRouterKeyId),
      ),
      columns: { id: true, openRouterKeyId: true, teamId: true, tenantKeyed: true },
    })
    for (const row of leftover) {
      if (!row.openRouterKeyId) continue
      try {
        // Reseller keys live on the tenant's account — revoke with the tenant key.
        const override = row.tenantKeyed
          ? (await getTenantOpenRouterKey(row.teamId)) ?? undefined
          : undefined
        await revokeRuntimeKey(row.openRouterKeyId, override)
        await db
          .update(instances)
          .set({ openRouterKeyId: null, openRouterKeyEnc: null })
          .where(eq(instances.id, row.id))
        report.openRouterKeysRevoked++
        await logInstanceEvent({
          instanceId: row.id,
          stage: "reconcile",
          action: "openrouter_key_revoke",
          result: "ok",
          message: `Reconciler revoked leftover OpenRouter key ${row.openRouterKeyId}.`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        report.errors.push(`or-key ${row.id}: ${msg}`)
      }
    }

    // (b) OpenRouter-side keys with our label prefix. One list call per
    // reconcile run (to stay within OpenRouter rate limits) serves two jobs:
    //   - keys with no matching non-deleted instance → orphan, revoke.
    //   - keys on a live instance whose cap drifted from the value we intend
    //     (`openRouterLimitUsd`) → a deposit-time PATCH that failed; re-PATCH.
    try {
      const orKeys = await listRuntimeKeys()
      // Map of OpenRouter keyId → intended cap, for every instance not in
      // `deleted` state — including failed_provisioning, which legitimately
      // retains its key for a retry. We match on the persisted keyId rather than
      // parsing the label, because the label is now a human-readable string
      // (`Sovereign-OpenClaw-<slug>`) that no longer encodes the instance id.
      const liveByKeyId = new Map<
        string,
        { openRouterLimitUsd: number | null; byosLlmMode: string | null }
      >()
      const liveRows = await db.query.instances.findMany({
        where: sql`${instances.status} != 'deleted' and ${instances.openRouterKeyId} is not null`,
        columns: { openRouterKeyId: true, openRouterLimitUsd: true, byosLlmMode: true },
      })
      for (const r of liveRows) {
        if (!r.openRouterKeyId) continue
        liveByKeyId.set(r.openRouterKeyId, {
          openRouterLimitUsd: r.openRouterLimitUsd ?? null,
          byosLlmMode: r.byosLlmMode ?? null,
        })
      }

      const LIMIT_EPSILON = 1e-6
      // Don't revoke very fresh keys: there's a sub-second window between
      // OpenRouter creating a key and us persisting its keyId on the instance
      // row. A key minted inside this window has no DB match yet but is NOT an
      // orphan. Skip revoking anything younger than the grace period.
      const MINT_GRACE_MS = 15 * 60 * 1000
      for (const key of orKeys) {
        // Case-insensitive so both the new `Sovereign-OpenClaw-*` labels and any
        // legacy lowercase `sovereign-<id>` keys are recognized as ours.
        if (!key.label.toLowerCase().startsWith(OR_LABEL_PREFIX)) continue
        const live = liveByKeyId.get(key.keyId)

        if (!live) {
          // No DB row owns this key. Treat recently-minted keys as in-flight
          // (mint→persist race) rather than orphans.
          if (key.createdAtMs != null && Date.now() - key.createdAtMs < MINT_GRACE_MS) {
            continue
          }
          // Orphan — revoke.
          try {
            await revokeRuntimeKey(key.keyId)
            report.openRouterKeysRevoked++
            console.log(
              JSON.stringify({
                kind: "reconcile_openrouter_orphan",
                keyId: key.keyId,
                label: key.label,
                action: "revoked",
              }),
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            report.errors.push(`or-orphan ${key.keyId}: ${msg}`)
          }
          continue
        }

        // Live — self-heal cap drift. Only adjust the limit (never `disabled`:
        // a key we disabled for low balance must stay disabled until the user
        // funds again). own_key BYOS instances don't carry our cap.
        const intended = live.openRouterLimitUsd
        if (
          live.byosLlmMode !== "own_key" &&
          intended != null &&
          Math.abs((key.limitUsd ?? -1) - intended) > LIMIT_EPSILON
        ) {
          try {
            await updateRuntimeKey(key.keyId, { limit: intended })
            report.openRouterLimitsHealed++
            console.log(
              JSON.stringify({
                kind: "reconcile_openrouter_limit",
                keyId: key.keyId,
                label: key.label,
                from: key.limitUsd,
                to: intended,
              }),
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            report.errors.push(`or-limit ${key.keyId}: ${msg}`)
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`or-list: ${msg}`)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // White-label custom domains: stamp domainVerifiedAt once the Cloudflare
  // cert goes active, so a tenant's domain activates on its own instead of only
  // when a branding manager reopens the status card. No-op without CF-for-SaaS.
  // ─────────────────────────────────────────────────────────────────────
  try {
    const { verified } = await reconcilePendingCustomHostnames()
    report.customHostnamesVerified = verified
  } catch (err) {
    report.errors.push(`cf-hostnames: ${err instanceof Error ? err.message : String(err)}`)
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
      providers: sweepTargets.map((t) => t.slug),
      ...report,
      scannedProviderVMs,
      scannedDbRows: owned.length,
    }),
  )
  return report
}
