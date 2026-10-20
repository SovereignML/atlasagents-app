// Warm VM pool — keep a small set of pre-booted, fully-bootstrapped VMs ready so
// a deploy can CLAIM one and skip the multi-minute cold install (see
// docs + plan). Each row in `warm_vms` is a single generic VM (no per-instance
// secrets) identified by a `poolKey` = provider|plan|region|runtime|webui.
//
// Two entry points:
//   - refillWarmPool()  — cron backstop: advance in-flight VMs, reap dead/stale
//                         ones, then create the deficit up to each target size.
//                         Stateful and SHORT per run (no long-held SSH polling),
//                         mirroring the reconciler + plan 028's no-long-work rule.
//   - claimWarmVm()     — deploy hot path: atomically grab one `ready` VM
//                         matching the request, then fire a fire-and-forget
//                         single-VM replacement so the pool refills instantly.

import crypto from "node:crypto"
import {
  db,
  pool,
  warmVms,
  orphanEvents,
  providers,
  eq,
  and,
  desc,
  like,
  inArray,
  isNotNull,
  sql,
} from "@/db"
import { getRuntime, type RuntimeId } from "@/lib/runtimes"
import { buildBakeFinalizeScript } from "@/lib/runtimes/finalize"
import { UNIVERSAL_POOL_RUNTIME, renderUniversalBootstrap } from "@/lib/runtimes/universal"
import { getVmProviderBySlug } from "@/lib/providers"
import { encryptSecret } from "@/lib/crypto-secret"
import { createAgentSubdomain, deleteAgentSubdomain, isAgentDnsEnabled } from "@/lib/agent-dns"
import { poolKeyFor } from "./warm-pool-key"
import {
  sshWaitReady,
  sshRun,
  sshRunScript,
  sshObserveHostFingerprint,
  sshReadBootstrapLogTail,
  type SshTarget,
} from "@/lib/ssh"
import { BOOTSTRAP_STATUS } from "@/lib/runtimes/bootstrap"
import {
  describeBakeFailure,
  describeOpenCircuit,
  isChurnedVm,
  isCircuitOpen,
  MIN_VIABLE_AGE_MS,
  recordFailure,
} from "@/lib/warm-pool-breaker"

/** An engine's own pool, or the universal one every chat-UI engine draws from. */
export type PoolRuntime = RuntimeId | typeof UNIVERSAL_POOL_RUNTIME

export type PoolTarget = {
  runtime: PoolRuntime
  webuiEnabled: boolean
  providerSlug: string
  planCode: string
  regionCode: string
  size: number
}

export type WarmPoolReport = {
  enabled: boolean
  advanced: number
  promotedReady: number
  reaped: number
  created: number
  errors: string[]
  /** Pool keys whose creates are paused by the failure circuit breaker. */
  pausedKeys?: string[]
  /** True when a run was skipped because another refill already held the lock. */
  skipped?: boolean
}

/** How long a VM may sit in creating/bootstrapping before we give up on it. */
const BOOTSTRAP_TTL_MS = 30 * 60 * 1000 // 30 min — comfortably over a cold bootstrap

/**
 * Bytes of bootstrap.log kept on a failed bake. Smaller than the VPS path's 24KB
 * tail: this is a pool VM with no customer waiting on it, and the value is
 * copied into an OrphanEvent that outlives the row — the failing step and its
 * immediate output sit at the very end of the log, so 8KB is ample.
 */
const WARM_LOG_TAIL_BYTES = 8_000
/** Hard cap on `lastError` so one runaway log can't bloat the row. */
const LAST_ERROR_MAX_CHARS = 12_000
/**
 * Hung bakes diagnosed per refill run. A hung pool fails the same way on every
 * VM, so one diagnosis per run is the whole signal; the cap keeps this cron
 * short (plan 028's no-long-work rule) when several rows time out at once.
 */
const MAX_HUNG_DIAGNOSES_PER_RUN = 1

/**
 * Recent bake-failure timestamps per pool key, feeding the create circuit
 * breaker (warm-pool-breaker.ts). Without it a broken bake loops forever:
 * failed row reaped within 60s → deficit → new VM → fails the same way, each
 * lap billing a real VM.
 *
 * Deliberately in-process rather than a table. Refills are already serialized
 * by an advisory lock and the app runs as a single pm2 fork, so there is one
 * writer; and losing the count on restart is the right failure mode for a
 * breaker — a restart gets a clean chance to refill rather than inheriting a
 * latch nobody can see. The durable record of *why* is the OrphanEvent written
 * by persistBakeFailure() — NOT WarmVm.lastError, whose row the reaper deletes.
 */
const bakeFailures = new Map<string, number[]>()
/** Recycle ready VMs older than this so `latest` runtime packages don't drift. */
const READY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days
/** A claimed row whose deploy is long done; the instance owns the VM now. */
const CLAIMED_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Default provider/plan/region for the pool — matches the env-default cold path. */
const DEFAULT_POOL_PROVIDER = process.env.POOL_PROVIDER_SLUG ?? "digitalocean"
const DEFAULT_POOL_PLAN = process.env.POOL_PLAN_CODE ?? "s-2vcpu-4gb"
const DEFAULT_POOL_REGION = process.env.POOL_REGION_CODE ?? "fra1"

/**
 * Policy: 2 universal + 1 OpenClaw ready in the primary region. A universal VM
 * has every chat-UI engine installed (every engine but OpenClaw: Hermes, Claude
 * Code, Codex, OpenCode, Pi, Gemini CLI, Grok; see runtimes/universal.ts), so a deploy of any of them claims one; it
 * replaced the Hermes-only target, whose 2 VMs served Hermes alone. A claim
 * fires an immediate replacement, so after one claim of each kind the
 * transient floor is 1 universal + 0 OpenClaw until the replacements reach
 * `ready` — a deploy arriving during that window takes the cold path. That is
 * the accepted trade for holding fewer idle VMs. Sizes are env-overridable via
 * POOL_SIZE_UNIVERSAL (POOL_SIZE_HERMES is still read, as its old name) and
 * POOL_SIZE_OPENCLAW, and a size of 0 disables that target entirely (it is then
 * skipped by both the create loop and the reap's active-key set).
 */
export function getPoolTargets(): PoolTarget[] {
  return [
    {
      runtime: UNIVERSAL_POOL_RUNTIME,
      webuiEnabled: true,
      providerSlug: DEFAULT_POOL_PROVIDER,
      planCode: DEFAULT_POOL_PLAN,
      regionCode: DEFAULT_POOL_REGION,
      size: Number(process.env.POOL_SIZE_UNIVERSAL ?? process.env.POOL_SIZE_HERMES ?? 2),
    },
    {
      runtime: "openclaw",
      webuiEnabled: false,
      providerSlug: DEFAULT_POOL_PROVIDER,
      planCode: DEFAULT_POOL_PLAN,
      regionCode: DEFAULT_POOL_REGION,
      size: Number(process.env.POOL_SIZE_OPENCLAW ?? 1),
    },
  ]
}

// Pool keys (and the bake identity folded into them) live in the pure
// ./warm-pool-key so their contract is unit-testable; re-exported here for
// existing importers.
export { bakeIdentity, poolKeyFor } from "./warm-pool-key"

/**
 * The warm pool is the primary delivery path, so it is ON by default whenever
 * the same live-mode prerequisites as real provisioning are present (a provider
 * token + the fleet SSH key). It is opt-OUT: set `POOL_ENABLED=false` to disable
 * it (e.g. dev/CI where you don't want billable VMs). Without the infra creds it
 * stays off regardless, so it never spins up VMs by accident in dev.
 */
export function isPoolEnabled(): boolean {
  if (process.env.POOL_ENABLED === "false") return false
  const hasProviderToken = Boolean(
    process.env.DIGITALOCEAN_API_TOKEN || process.env.LINODE_API_TOKEN,
  )
  return hasProviderToken && Boolean(process.env.SSH_FLEET_PRIVATE_KEY)
}

function generateRootPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = crypto.randomBytes(24)
  let out = ""
  for (let i = 0; i < 24; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function resolveProviderId(slug: string): Promise<string | null> {
  const row = await db.query.providers.findFirst({
    where: eq(providers.slug, slug),
    columns: { id: true },
  })
  return row?.id ?? null
}

/**
 * Create one warm VM for a target: boot it with the runtime's normal cloud-init
 * bootstrap and record a `creating` row. The heavy install runs on the box; a
 * later refill pass advances it to `ready`.
 */
async function createOneWarmVm(target: PoolTarget): Promise<void> {
  const universal = target.runtime === UNIVERSAL_POOL_RUNTIME
  const runtime = universal ? null : getRuntime(target.runtime)
  const slot = universal ? UNIVERSAL_POOL_RUNTIME : runtime!.id
  const provider = await getVmProviderBySlug(target.providerSlug)
  const providerId = await resolveProviderId(target.providerSlug)
  const rootPassword = generateRootPassword()
  const publicKey = process.env.SSH_FLEET_PUBLIC_KEY

  const bootstrapScript = runtime
    ? runtime.renderBootstrap({
        gatewayPort: runtime.gatewayPort,
        webuiEnabled: target.webuiEnabled && Boolean(runtime.sidecar),
      })
    : renderUniversalBootstrap()

  const vm = await provider.createVM({
    label: `sovereign-pool-${slot}-${crypto.randomBytes(4).toString("hex")}`,
    plan: target.planCode,
    region: target.regionCode,
    rootPassword,
    authorizedKeys: publicKey ? [publicKey] : undefined,
    tags: ["sovereignml", slot, "vps", "pool"],
    userData: bootstrapScript,
  })

  // The VM is now billing. If we cannot record it, destroy it immediately
  // rather than letting it leak: an untracked VM has no WarmVm row, so the pool
  // sees the deficit as unmet and creates *another* one on the next 60s tick,
  // while the untracked one bills until the reconciler's orphan sweep (up to 15
  // min later, and only after its grace period) happens to notice. That is the
  // same runaway shape as a failing bake, arriving by a different door.
  try {
    await db.insert(warmVms).values({
      poolKey: poolKeyFor(target),
      providerId,
      providerSlug: target.providerSlug,
      providerPlanCode: target.planCode,
      providerRegionCode: target.regionCode,
      runtime: slot,
      webuiEnabled: target.webuiEnabled,
      vmId: vm.id,
      ipAddress: vm.ipv4?.[0] ?? null,
      rootPasswordEnc: encryptSecret(rootPassword),
      status: "creating",
    })
  } catch (err) {
    console.error(
      `[warm-pool] could not record warm VM ${vm.id} (${target.providerSlug}); destroying it so it does not bill untracked:`,
      err,
    )
    try {
      await provider.deleteVM(vm.id)
    } catch {
      // The orphan sweep is the backstop — it matches on the "sovereignml" tag
      // this VM carries, and the row that would have exempted it was never
      // written, so it will be collected there.
    }
    throw err
  }
}

/**
 * Advance one in-flight warm VM by at most one step. Never blocks for long: SSH
 * probes are short and bounded, so a full refill pass stays quick. Rows that
 * aren't ready to advance are simply left for the next pass.
 */
async function advanceWarmVm(row: typeof warmVms.$inferSelect): Promise<{
  promotedReady: boolean
}> {
  const provider = await getVmProviderBySlug(row.providerSlug)

  // creating → bootstrapping: wait for the provider to report running + an IP.
  if (row.status === "creating") {
    if (!row.vmId) return { promotedReady: false }
    const vm = await provider.getVMOrNull(row.vmId)
    const ip = vm?.ipv4?.[0]
    if (vm?.status === "running" && ip) {
      await db
        .update(warmVms)
        .set({ ipAddress: ip, status: "bootstrapping" })
        .where(eq(warmVms.id, row.id))
    }
    return { promotedReady: false }
  }

  // bootstrapping → ready: one-shot status-file check (no long polling here).
  if (row.status === "bootstrapping") {
    const ip = row.ipAddress
    if (!ip) return { promotedReady: false }
    const target: SshTarget = { host: ip }
    let status = ""
    try {
      // Short readiness probe; if sshd isn't up yet, leave for the next pass.
      await sshWaitReady(target, 15_000, 5_000)
      const r = await sshRun(target, `cat ${BOOTSTRAP_STATUS} 2>/dev/null || echo pending`)
      status = r.stdout.trim()
    } catch {
      return { promotedReady: false }
    }

    if (status.startsWith("failed:")) {
      // Capture the evidence NOW, while the box is still alive and we already
      // hold a working SSH session. The reaper destroys this VM (and deletes
      // this row) within ~60s, so a bare `bootstrap failed:<step>` would be the
      // only trace left — enough to know the bake broke, never enough to know
      // why. The log tail is what names the failing command.
      const logTail = await sshReadBootstrapLogTail(target, WARM_LOG_TAIL_BYTES)
      await db
        .update(warmVms)
        .set({
          status: "failed",
          lastError: `bootstrap ${status}\n--- bootstrap.log tail ---\n${logTail}`.slice(
            0,
            LAST_ERROR_MAX_CHARS,
          ),
        })
        .where(eq(warmVms.id, row.id))
      return { promotedReady: false }
    }
    if (status !== "done") return { promotedReady: false }

    // Bootstrap complete — run bake-finalize + capture the host fingerprint,
    // then mark ready. Failures here are non-fatal (best-effort warmup).
    try {
      // Generous timeout: Hermes' setup/doctor warm-up is the slow part, and it
      // is exactly the cost we want paid here, not at claim.
      await sshRunScript(
        target,
        buildBakeFinalizeScript(row.runtime as PoolRuntime),
        { timeoutMs: 480_000 },
      )
    } catch {
      // warmup failed — still usable; claim re-runs the authoritative config.
    }
    let fingerprint: string | null = null
    try {
      fingerprint = await sshObserveHostFingerprint(target)
    } catch {
      // no fingerprint captured — claim will pin on first connect instead.
    }

    // Pre-assign a generic public URL so a claim is an instant hand-off: the
    // Cloudflare record is already created + propagated by the time someone
    // deploys, taking the DNS call + propagation off the hot path. Best-effort
    // and idempotent — reuse an existing record, skip when creds/IP are absent,
    // and never fail the promotion over a DNS hiccup (claim then mints its own).
    let managedSubdomain: string | null = row.managedSubdomain ?? null
    let cfRecordId: string | null = row.cfRecordId ?? null
    if (!managedSubdomain && isAgentDnsEnabled() && ip) {
      try {
        const generic = `agent-${crypto.randomBytes(4).toString("hex")}`
        const res = await createAgentSubdomain(generic, ip)
        managedSubdomain = res.name
        cfRecordId = res.recordId
      } catch {
        // no URL pre-assigned — claim falls back to per-instance DNS creation.
      }
    }

    await db
      .update(warmVms)
      .set({
        status: "ready",
        readyAt: new Date(),
        sshHostFingerprint: fingerprint,
        managedSubdomain,
        cfRecordId,
      })
      .where(eq(warmVms.id, row.id))
    return { promotedReady: true }
  }

  return { promotedReady: false }
}

/**
 * Best-effort diagnosis of a bake that never finished. A hung row has no
 * `lastError` — it timed out rather than reporting failure — so without this the
 * only durable fact is "it hung", which does not tell you whether the box was
 * unreachable, still chewing on apt, or wedged on one step.
 *
 * Tightly bounded and never throws: this runs inside the refill cron, which must
 * stay short.
 */
async function diagnoseHungBake(row: typeof warmVms.$inferSelect): Promise<string> {
  if (!row.ipAddress) return "no IP was ever assigned (provider never reported a running VM)"
  const target: SshTarget = { host: row.ipAddress }
  try {
    await sshWaitReady(target, 10_000, 5_000)
  } catch {
    return `unreachable over SSH at ${row.ipAddress} after ${BOOTSTRAP_TTL_MS / 60_000}m`
  }
  let status = "(unknown)"
  try {
    const r = await sshRun(target, `cat ${BOOTSTRAP_STATUS} 2>/dev/null || echo pending`)
    status = r.stdout.trim() || "(empty)"
  } catch {
    // fall through — the log tail is still worth having
  }
  const logTail = await sshReadBootstrapLogTail(target, WARM_LOG_TAIL_BYTES)
  return `still at bootstrap status "${status}"\n--- bootstrap.log tail ---\n${logTail}`
}

/**
 * Write a bake failure somewhere that OUTLIVES the row.
 *
 * The reaper deletes the WarmVm row seconds after the failure, taking
 * `lastError` with it — so the pool could fail thousands of times and leave
 * nothing behind to diagnose from. OrphanEvent is already the ledger for reaped
 * warm VMs (they have no Instance row to carry state), so the reason goes there,
 * plus stderr for whoever is reading pm2 logs.
 */
async function persistBakeFailure(
  row: typeof warmVms.$inferSelect,
  reason: string,
): Promise<string> {
  const notice = describeBakeFailure(
    {
      poolKey: row.poolKey,
      vmId: row.vmId,
      status: row.status,
      createdAtMs: row.createdAt?.getTime() ?? null,
      reason,
    },
    Date.now(),
  )
  console.error(`[warm-pool] ${notice}`)
  try {
    await db.insert(orphanEvents).values({
      vmId: row.vmId ?? row.id,
      action: "failed",
      ipAddress: row.ipAddress,
      resolvedAt: new Date(),
      detail: notice.slice(0, LAST_ERROR_MAX_CHARS),
    })
  } catch {
    // Durable-record insert is best-effort — never let it block the reap, and
    // the console line above is already written.
  }
  return notice
}

/** Delete a warm VM at the provider + drop its row. Best-effort on the VM delete. */
export async function destroyWarmVm(row: typeof warmVms.$inferSelect): Promise<void> {
  if (row.vmId) {
    try {
      const provider = await getVmProviderBySlug(row.providerSlug)
      await provider.deleteVM(row.vmId)
    } catch {
      // reconciler orphan sweep is the backstop for a leaked VM.
    }
  }
  // Tear down the pre-assigned generic DNS record (unclaimed VMs only — a claimed
  // row's record now belongs to its instance and is dropped, never destroyed).
  if (row.cfRecordId) {
    try {
      // The hostname picks the zone the record lives in.
      await deleteAgentSubdomain(row.id, row.cfRecordId, row.managedSubdomain)
    } catch {
      // best-effort — a leaked record just points at a dead IP.
    }
  }
  // Record the released public IP before the row (and its ipAddress) is gone.
  // Warm VMs have no persistent Instance row to carry `deletedIpAddress`, so the
  // released-IP ledger for them lives in OrphanEvent. Best-effort — never let a
  // logging insert block the reap.
  if (row.ipAddress) {
    try {
      await db.insert(orphanEvents).values({
        vmId: row.vmId ?? row.id,
        action: "deleted",
        ipAddress: row.ipAddress,
        resolvedAt: new Date(),
        detail: `warm-pool reap; provider=${row.providerSlug}; poolKey=${row.poolKey}`,
      })
    } catch {
      // ledger insert is best-effort — proceed with the reap regardless.
    }
  }
  await db.delete(warmVms).where(eq(warmVms.id, row.id))
}

/**
 * Cron backstop. Advance in-flight VMs, reap dead/stale ones, then create the
 * deficit for each target up to its `size`. Short per run.
 */
export async function refillWarmPool(): Promise<WarmPoolReport> {
  const report: WarmPoolReport = {
    enabled: isPoolEnabled(),
    advanced: 0,
    promotedReady: 0,
    reaped: 0,
    created: 0,
    errors: [],
  }
  if (!report.enabled) return report

  // 1. Advance in-flight rows.
  const inFlight = await db.query.warmVms.findMany({
    where: inArray(warmVms.status, ["creating", "bootstrapping"]),
  })
  for (const row of inFlight) {
    try {
      const { promotedReady } = await advanceWarmVm(row)
      report.advanced++
      if (promotedReady) report.promotedReady++
    } catch (err) {
      report.errors.push(`advance ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 2. Reap: failed rows, in-flight rows past the bootstrap TTL, stale ready
  //    rows (package drift), long-settled claimed rows, and — importantly —
  //    any row whose poolKey no longer matches a configured target (e.g. the
  //    plan/region was reconfigured). Without the last rule a config change
  //    would leave the old-keyed VMs billing forever, never claimed.
  const activeKeys = new Set(
    getPoolTargets()
      .filter((t) => t.size > 0)
      .map((t) => poolKeyFor(t)),
  )
  const now = Date.now()
  /** Bounds the hung-bake probing below to MAX_HUNG_DIAGNOSES_PER_RUN. */
  let hungDiagnosed = 0
  const reapCandidates = await db.query.warmVms.findMany({})
  for (const row of reapCandidates) {
    const created = row.createdAt?.getTime() ?? now
    const ready = row.readyAt?.getTime() ?? now
    const claimed = row.claimedAt?.getTime() ?? now
    const staleKey = !activeKeys.has(row.poolKey)
    const bakeFailed = row.status === "failed"
    const bakeHung =
      ["creating", "bootstrapping"].includes(row.status) && now - created > BOOTSTRAP_TTL_MS
    const shouldReap =
      staleKey ||
      bakeFailed ||
      bakeHung ||
      (row.status === "ready" && now - ready > READY_MAX_AGE_MS) ||
      (row.status === "claimed" && now - claimed > CLAIMED_TTL_MS)
    if (!shouldReap) continue

    // A settled `claimed` row is success — we drop the row and the instance
    // keeps the VM, so nothing is destroyed and nothing is wasted.
    const destroysVm = row.status !== "claimed"
    // Beyond an outright bake failure and one that never finished, count any
    // reap that destroys a VM too young to have been useful. A stale poolKey is
    // *normally* a config change and a stale `ready` row is the 3-day recycle —
    // but either one firing on a VM minutes old means create and reap disagree,
    // and that is a money-burning loop no matter which rule is doing the
    // burning. Age catches every loop shape; the bake-failure check alone only
    // caught one of them.
    const churned =
      destroysVm && !bakeFailed && !bakeHung && isChurnedVm(row.createdAt?.getTime() ?? null, now)

    if (bakeFailed || bakeHung || churned) {
      bakeFailures.set(
        row.poolKey,
        recordFailure(bakeFailures.get(row.poolKey) ?? [], now),
      )
      // Preserve WHY before destroyWarmVm() deletes the row. A failed row
      // already carries the bootstrap log tail in lastError (captured at the
      // moment of failure); a hung one carries nothing, so probe it — capped
      // per run so a wholly-broken pool can't stretch this cron out.
      let reason = row.lastError ?? "(no lastError recorded)"
      if (churned) {
        // Name the rule that fired, since for a churn reap the rule IS the bug.
        const rule = staleKey
          ? `its poolKey "${row.poolKey}" matches no configured target (create and reap disagree — ` +
            `check POOL_PROVIDER_SLUG / POOL_PLAN_CODE / POOL_REGION_CODE / POOL_SIZE_*)`
          : `the "${row.status}" reap rule`
        reason =
          `destroyed by ${rule} at ${Math.round((now - created) / 1000)}s old — under the ` +
          `${MIN_VIABLE_AGE_MS / 60_000}m minimum viable age, so this VM was billed and never usable`
      } else if (bakeHung) {
        if (hungDiagnosed < MAX_HUNG_DIAGNOSES_PER_RUN) {
          hungDiagnosed++
          reason = await diagnoseHungBake(row)
        } else {
          reason = `hung in "${row.status}" past the ${
            BOOTSTRAP_TTL_MS / 60_000
          }m bootstrap TTL (not probed — diagnosis cap reached this run)`
        }
      }
      // Only the headline goes into the report — /api/internal/pool-refill
      // returns it as JSON, and several failures each carrying an 8KB log tail
      // would turn a status response into a payload. The full evidence is in
      // the OrphanEvent row and the stderr line persistBakeFailure writes.
      const notice = await persistBakeFailure(row, reason)
      report.errors.push(notice.split("\n")[0])
    }
    try {
      // A settled claimed VM belongs to its instance now — just drop the row,
      // don't delete the VM out from under a live agent.
      if (row.status === "claimed") {
        await db.delete(warmVms).where(eq(warmVms.id, row.id))
      } else {
        await destroyWarmVm(row)
      }
      report.reaped++
    } catch (err) {
      report.errors.push(`reap ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 3. Create the deficit per target (count creating+bootstrapping+ready so the
  //    event-driven replacement fired on claim isn't double-provisioned).
  for (const target of getPoolTargets()) {
    if (target.size <= 0) continue
    const key = poolKeyFor(target)

    // Stop feeding a bake that keeps failing. The breaker closes on its own as
    // failures age out, so a fixed pool refills without intervention.
    const failures = bakeFailures.get(key) ?? []
    if (isCircuitOpen(failures, now)) {
      const notice = describeOpenCircuit(key, failures, now)
      if (!report.pausedKeys) report.pausedKeys = []
      report.pausedKeys.push(key)
      report.errors.push(notice)
      console.warn(`[warm-pool] ${notice}`)
      continue
    }

    try {
      const rows = await db.query.warmVms.findMany({
        where: and(
          eq(warmVms.poolKey, key),
          inArray(warmVms.status, ["creating", "bootstrapping", "ready"]),
        ),
        columns: { id: true },
      })
      const deficit = target.size - rows.length
      for (let i = 0; i < deficit; i++) {
        await createOneWarmVm(target)
        report.created++
      }
    } catch (err) {
      // Feed the breaker: a create that keeps throwing is its own loop. It can
      // also leak — provider.createVM may have succeeded before the row insert
      // failed — and a leaked VM has no row, so it produces no churn signal and
      // waits for the reconciler's orphan sweep. Counting the throw is what
      // stops us re-entering the same create every 60s meanwhile.
      bakeFailures.set(key, recordFailure(bakeFailures.get(key) ?? [], Date.now()))
      report.errors.push(`create ${key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return report
}

export type ClaimedWarmVm = {
  warmVmId: string
  vmId: string
  ipAddress: string
  providerId: string | null
  rootPasswordEnc: string | null
  sshHostFingerprint: string | null
  /** Generic public URL pre-assigned at bake; the instance reuses it at claim. */
  managedSubdomain: string | null
  cfRecordId: string | null
  poolKey: string
}

/**
 * Atomically claim one `ready` warm VM matching any of the ranked candidate
 * (provider, plan, region) tuples for this runtime. `FOR UPDATE SKIP LOCKED`
 * guarantees two concurrent deploys never grab the same VM. On success, fires a
 * fire-and-forget replacement so the pool refills instantly (the cron is the
 * backstop). Returns null when the pool is disabled or has no match.
 */
export async function claimWarmVm(opts: {
  runtime: RuntimeId
  webuiEnabled: boolean
  instanceId: string
  candidates: Array<{ providerSlug: string; planCode: string; regionCode: string }>
}): Promise<ClaimedWarmVm | null> {
  if (!isPoolEnabled()) return null
  const poolKeys = opts.candidates.map((c) =>
    poolKeyFor({
      providerSlug: c.providerSlug,
      planCode: c.planCode,
      regionCode: c.regionCode,
      runtime: opts.runtime,
      webuiEnabled: opts.webuiEnabled,
    }),
  )
  if (poolKeys.length === 0) return null

  // Explicit ARRAY[$1, $2, …] so the array binds unambiguously for `= ANY(...)`
  // regardless of driver array-serialization behavior.
  const keysArray = sql`ARRAY[${sql.join(
    poolKeys.map((k) => sql`${k}`),
    sql`, `,
  )}]`

  // FOR UPDATE SKIP LOCKED in the subquery guarantees two concurrent deploys
  // never grab the same VM: each statement locks a distinct ready row (or finds
  // none and falls back to the cold path). Single-statement autocommit → the
  // lock + status flip are atomic.
  const res = await db.execute(sql`
    UPDATE "WarmVm"
    SET status = 'claimed',
        "claimedByInstanceId" = ${opts.instanceId},
        "claimedAt" = now(),
        "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "WarmVm"
      WHERE status = 'ready'
        AND "vmId" IS NOT NULL
        AND "ipAddress" IS NOT NULL
        AND "poolKey" = ANY(${keysArray})
      ORDER BY "readyAt" ASC NULLS LAST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "vmId", "ipAddress", "providerId", "rootPasswordEnc", "sshHostFingerprint", "managedSubdomain", "cfRecordId", "poolKey";
  `)

  const rows = (res as unknown as { rows: Array<Record<string, unknown>> }).rows ?? []
  const row = rows[0]
  if (!row) return null

  const claimed: ClaimedWarmVm = {
    warmVmId: String(row.id),
    vmId: String(row.vmId),
    ipAddress: String(row.ipAddress),
    providerId: row.providerId != null ? String(row.providerId) : null,
    rootPasswordEnc: row.rootPasswordEnc != null ? String(row.rootPasswordEnc) : null,
    sshHostFingerprint:
      row.sshHostFingerprint != null ? String(row.sshHostFingerprint) : null,
    managedSubdomain: row.managedSubdomain != null ? String(row.managedSubdomain) : null,
    cfRecordId: row.cfRecordId != null ? String(row.cfRecordId) : null,
    poolKey: String(row.poolKey),
  }

  // Event-driven refill: replace the claimed VM immediately. Fire-and-forget so
  // the deploy is never blocked; the cron reconciles if this fails to start.
  const target = getPoolTargets().find((t) => poolKeyFor(t) === claimed.poolKey)
  if (target) {
    void createOneWarmVm(target).catch(() => {
      // best-effort — refillWarmPool() is the backstop.
    })
  }

  return claimed
}

/**
 * All warm-pool rows, ordered for admin display: grouped by poolKey, newest
 * first within a key. Read-only; used by the admin Pool tab + dashboard strip.
 */
export async function listWarmVms(): Promise<Array<typeof warmVms.$inferSelect>> {
  return db.query.warmVms.findMany({
    orderBy: (t, { asc, desc }) => [asc(t.poolKey), desc(t.createdAt)],
  })
}

/** Per-poolKey fill snapshot for the admin health summary. */
export type PoolHealthEntry = {
  poolKey: string
  runtime: PoolRuntime
  webuiEnabled: boolean
  providerSlug: string
  planCode: string
  regionCode: string
  target: number
  ready: number
  inFlight: number // creating + bootstrapping
  claimed: number
  failed: number
  /** Missing ready VMs vs target (never negative). */
  deficit: number
}

export type PoolHealth = {
  enabled: boolean
  entries: PoolHealthEntry[]
}

/**
 * Current fill state per configured pool target, computed from a single scan of
 * `warmVms`. Snapshot only (no history). Targets with `size <= 0` are skipped so
 * the summary matches what the refill loop actually maintains.
 */
export async function getPoolHealth(): Promise<PoolHealth> {
  const targets = getPoolTargets().filter((t) => t.size > 0)
  const rows = await db.query.warmVms.findMany({
    columns: { poolKey: true, status: true },
  })

  const counts = new Map<string, { ready: number; inFlight: number; claimed: number; failed: number }>()
  for (const r of rows) {
    const c = counts.get(r.poolKey) ?? { ready: 0, inFlight: 0, claimed: 0, failed: 0 }
    if (r.status === "ready") c.ready++
    else if (r.status === "creating" || r.status === "bootstrapping") c.inFlight++
    else if (r.status === "claimed") c.claimed++
    else if (r.status === "failed") c.failed++
    counts.set(r.poolKey, c)
  }

  const entries: PoolHealthEntry[] = targets.map((t) => {
    const key = poolKeyFor(t)
    const c = counts.get(key) ?? { ready: 0, inFlight: 0, claimed: 0, failed: 0 }
    return {
      poolKey: key,
      runtime: t.runtime,
      webuiEnabled: t.webuiEnabled,
      providerSlug: t.providerSlug,
      planCode: t.planCode,
      regionCode: t.regionCode,
      target: t.size,
      ready: c.ready,
      inFlight: c.inFlight,
      claimed: c.claimed,
      failed: c.failed,
      deficit: Math.max(0, t.size - c.ready),
    }
  })

  return { enabled: isPoolEnabled(), entries }
}

/** One reaped bake failure, as recorded by persistBakeFailure(). */
export type BakeFailureRecord = {
  id: string
  detectedAt: Date | null
  vmId: string
  ipAddress: string | null
  detail: string
}

/**
 * Recent bake failures, newest first.
 *
 * Read from `OrphanEvent`, not `WarmVm`: a failed row is destroyed in the same
 * refill pass that marks it, so the live-rows view an operator sees is *always*
 * empty of failures no matter how hard the pool is churning. That is precisely
 * why a broken pool looked like a quiet one. These records survive.
 */
export async function listRecentBakeFailures(limit = 20): Promise<BakeFailureRecord[]> {
  const rows = await db
    .select({
      id: orphanEvents.id,
      detectedAt: orphanEvents.detectedAt,
      vmId: orphanEvents.vmId,
      ipAddress: orphanEvents.ipAddress,
      detail: orphanEvents.detail,
    })
    .from(orphanEvents)
    .where(and(eq(orphanEvents.action, "failed"), like(orphanEvents.detail, "warm-pool%")))
    .orderBy(desc(orphanEvents.detectedAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, detail: r.detail ?? "" }))
}

/**
 * vmIds currently tracked by the pool. The reconciler adds these to its
 * "owned" set so its orphan sweep never reaps a live pool VM.
 */
export async function getWarmVmIds(): Promise<Set<string>> {
  const rows = await db.query.warmVms.findMany({
    where: isNotNull(warmVms.vmId),
    columns: { vmId: true },
  })
  const set = new Set<string>()
  for (const r of rows) if (r.vmId) set.add(r.vmId)
  return set
}

/* ------------------------------------------------------------------ */
/* Self-driving refill — in-process scheduler (no external cron)       */
/* ------------------------------------------------------------------ */

/**
 * Fixed advisory-lock key so only ONE refill runs at a time across every Node
 * process sharing this database (mirrors host-scheduler's SCHEDULER_LOCK_KEY).
 * The pool creates billable VMs, so a cross-process double-create race must be
 * prevented even though the app normally runs as a single pm2 fork. Value is
 * "WMP0" in hex — any constant works as long as it's unique to this lock.
 */
const REFILL_LOCK_KEY = 0x57_4d_50_30

function emptyReport(): WarmPoolReport {
  return { enabled: isPoolEnabled(), advanced: 0, promotedReady: 0, reaped: 0, created: 0, errors: [] }
}

/**
 * Run `refillWarmPool()` under a Postgres advisory lock so overlapping runs
 * (the in-process tick, a manual admin trigger, a legacy external cron, or a
 * second app process) can never race. Uses a DEDICATED session client — not a
 * transaction — so we don't hold a pooled connection open around the slow SSH /
 * provider calls inside the refill; only the lightweight lock connection is
 * parked for the duration. Returns `{ skipped: true }` when another run holds
 * the lock.
 */
export async function refillWarmPoolLocked(): Promise<WarmPoolReport> {
  if (!isPoolEnabled()) return emptyReport()
  const client = await pool.connect()
  let locked = false
  try {
    const res = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [REFILL_LOCK_KEY],
    )
    locked = res.rows[0]?.ok === true
    if (!locked) return { ...emptyReport(), skipped: true }
    return await refillWarmPool()
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [REFILL_LOCK_KEY])
      } catch {
        // session ending / lock already released — harmless
      }
    }
    client.release()
  }
}

/** Recycle ready VMs / advance-in-flight cadence for the in-process scheduler. */
const REFILL_INTERVAL_MS = Number(process.env.POOL_REFILL_INTERVAL_MS) || 60_000
/** Floor between self-driven runs, so stacked timers/manual pokes don't pile up. */
const REFILL_MIN_INTERVAL_MS = 55_000

let lastRefillAt = 0
let refillInFlight: Promise<unknown> | null = null

/**
 * Throttled, de-duped, never-throwing refill for the boot scheduler. No-ops
 * when the pool is disabled, when one ran in the last ~55s, or when one is
 * already running (single in-flight promise, process-wide). Cross-process
 * safety comes from the advisory lock in `refillWarmPoolLocked`.
 */
/**
 * Print the errors a scheduled refill collected that nothing else logs: a
 * create that throws (provider API refusal, DNS, a bootstrap that cannot be
 * rendered), an advance or a reap. Before this they only fed the breaker, so
 * the logs said "3 bake failure(s)" and never why. Bake failures and breaker
 * pauses are logged where they happen.
 */
function logRefillErrors(report: WarmPoolReport): void {
  for (const e of report.errors) {
    if (/^(create|advance|reap) /.test(e)) console.warn(`[warm-pool] ${e}`)
  }
}

export async function maybeRefillWarmPool(): Promise<void> {
  if (!isPoolEnabled()) return
  if (refillInFlight) {
    await refillInFlight.catch(() => {})
    return
  }
  if (Date.now() - lastRefillAt < REFILL_MIN_INTERVAL_MS) return
  lastRefillAt = Date.now()
  refillInFlight = refillWarmPoolLocked()
    .then(logRefillErrors)
    .catch((err) => console.error("[warm-pool] refill failed:", err))
    .finally(() => {
      refillInFlight = null
    })
  await refillInFlight
}

let schedulerStarted = false

/**
 * Start the in-process warm-pool scheduler at server boot so the pool refills
 * itself with ZERO external cron wiring. Idempotent (safe to call more than
 * once), no-op when the pool is disabled. Fires one kick shortly after boot,
 * then ticks every `POOL_REFILL_INTERVAL_MS` (default 60s). The timers are
 * `unref()`d so they never keep the process alive (tests / graceful shutdown).
 * Called from src/instrumentation.ts on the Node runtime only.
 */
export function startWarmPoolScheduler(): void {
  if (schedulerStarted) return
  if (!isPoolEnabled()) return
  schedulerStarted = true

  // Prime the pool ~10s after boot (let the server settle first).
  const kick = setTimeout(() => {
    void maybeRefillWarmPool()
  }, 10_000)
  kick.unref?.()

  const tick = setInterval(() => {
    void maybeRefillWarmPool()
  }, REFILL_INTERVAL_MS)
  tick.unref?.()
}
