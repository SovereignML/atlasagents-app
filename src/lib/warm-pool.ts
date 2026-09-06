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
  inArray,
  isNotNull,
  sql,
} from "@/db"
import { getRuntime, type RuntimeId } from "@/lib/runtimes"
import { getVmProviderBySlug } from "@/lib/providers"
import { encryptSecret } from "@/lib/crypto-secret"
import { createAgentSubdomain, deleteAgentSubdomain } from "@/lib/agent-dns"
import {
  sshWaitReady,
  sshRun,
  sshRunScript,
  sshObserveHostFingerprint,
  type SshTarget,
} from "@/lib/ssh"
import { BOOTSTRAP_STATUS } from "@/lib/runtimes/bootstrap"

export type PoolTarget = {
  runtime: RuntimeId
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
  /** True when a run was skipped because another refill already held the lock. */
  skipped?: boolean
}

/** How long a VM may sit in creating/bootstrapping before we give up on it. */
const BOOTSTRAP_TTL_MS = 30 * 60 * 1000 // 30 min — comfortably over a cold bootstrap
/** Recycle ready VMs older than this so `latest` runtime packages don't drift. */
const READY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days
/** A claimed row whose deploy is long done; the instance owns the VM now. */
const CLAIMED_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Default provider/plan/region for the pool — matches the env-default cold path. */
const DEFAULT_POOL_PROVIDER = process.env.POOL_PROVIDER_SLUG ?? "digitalocean"
const DEFAULT_POOL_PLAN = process.env.POOL_PLAN_CODE ?? "s-2vcpu-4gb"
const DEFAULT_POOL_REGION = process.env.POOL_REGION_CODE ?? "fra1"

/**
 * Starting policy (see plan): 3 Hermes + 2 OpenClaw ready in the primary
 * region. A claim fires an immediate replacement, so after one claim of each
 * runtime the transient floor is 2 Hermes + 1 OpenClaw until the replacements
 * reach `ready`. Sizes are env-overridable.
 */
export function getPoolTargets(): PoolTarget[] {
  return [
    {
      runtime: "hermes",
      webuiEnabled: true,
      providerSlug: DEFAULT_POOL_PROVIDER,
      planCode: DEFAULT_POOL_PLAN,
      regionCode: DEFAULT_POOL_REGION,
      size: Number(process.env.POOL_SIZE_HERMES ?? 3),
    },
    {
      runtime: "openclaw",
      webuiEnabled: false,
      providerSlug: DEFAULT_POOL_PROVIDER,
      planCode: DEFAULT_POOL_PLAN,
      regionCode: DEFAULT_POOL_REGION,
      size: Number(process.env.POOL_SIZE_OPENCLAW ?? 2),
    },
  ]
}

export function poolKeyFor(t: {
  providerSlug: string
  planCode: string
  regionCode: string
  runtime: string
  webuiEnabled: boolean
}): string {
  return `${t.providerSlug}|${t.planCode}|${t.regionCode}|${t.runtime}|${t.webuiEnabled ? 1 : 0}`
}

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

/** Platform-zone Cloudflare DNS is only usable when both creds are present. */
function cloudflareDnsEnabled(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID)
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
  const runtime = getRuntime(target.runtime)
  const provider = await getVmProviderBySlug(target.providerSlug)
  const providerId = await resolveProviderId(target.providerSlug)
  const rootPassword = generateRootPassword()
  const publicKey = process.env.SSH_FLEET_PUBLIC_KEY

  const bootstrapScript = runtime.renderBootstrap({
    gatewayPort: runtime.gatewayPort,
    webuiEnabled: target.webuiEnabled && Boolean(runtime.sidecar),
  })

  const vm = await provider.createVM({
    label: `sovereign-pool-${runtime.id}-${crypto.randomBytes(4).toString("hex")}`,
    plan: target.planCode,
    region: target.regionCode,
    rootPassword,
    authorizedKeys: publicKey ? [publicKey] : undefined,
    tags: ["sovereignml", runtime.id, "vps", "pool"],
    userData: bootstrapScript,
  })

  await db.insert(warmVms).values({
    poolKey: poolKeyFor(target),
    providerId,
    providerSlug: target.providerSlug,
    providerPlanCode: target.planCode,
    providerRegionCode: target.regionCode,
    runtime: runtime.id,
    webuiEnabled: target.webuiEnabled,
    vmId: vm.id,
    ipAddress: vm.ipv4?.[0] ?? null,
    rootPasswordEnc: encryptSecret(rootPassword),
    status: "creating",
  })
}

/**
 * Bake-finalize: the slow-once, per-instance-INDEPENDENT work, run once the box
 * has bootstrapped so the eventual claim is fast. Idempotent.
 *  - Hermes: warm the venv + scaffold config via `setup --quick` + `doctor`
 *    (the expensive CLI cold starts), and pre-start Open WebUI so its SQLite DB
 *    + Python caches are warm (it boots fine without a live gateway upstream).
 *  - Both: install + enable the systemd unit(s) so claim only rewrites config
 *    and restarts, never installs.
 * Everything is best-effort (`|| true`): the authoritative config + start still
 * happens at claim, so a warmup miss only costs a little latency, never breaks.
 */
function buildBakeFinalizeScript(runtimeId: RuntimeId, webuiEnabled: boolean): string {
  const runtime = getRuntime(runtimeId)
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const unitB64 = Buffer.from(runtime.renderSystemdUnit(), "utf8").toString("base64")

  let hermesWarm = ""
  if (runtime.id === "hermes") {
    const runAs = (sub: string) =>
      `sudo -u ${q(runtime.paths.systemUser)} env HOME=${q(runtime.paths.installDir)} ${q(runtime.cliBinary)} ${sub} || true`
    hermesWarm = `
echo "=== bake: hermes warmup ==="
${runAs("setup --non-interactive --quick")}
${runAs("doctor --fix")}
`
  }

  let sidecarWarm = ""
  if (webuiEnabled && runtime.sidecar) {
    const sc = runtime.sidecar
    const sidecarUnitB64 = Buffer.from(sc.renderSystemdUnit(), "utf8").toString("base64")
    // Placeholder env — rewritten with real secrets at claim. Enough for Open
    // WebUI to boot and initialize its DB (it does not require a live upstream).
    const placeholderEnv = sc.renderEnv({
      // Minimal instance stub; renderEnv reads gatewayToken/port/secret/publicUrl/model.
      instance: { id: "pool", domain: null } as never,
      gatewayToken: "pool-placeholder-token",
      gatewayPort: runtime.gatewayPort,
      secretKey: "pool-placeholder-secret",
      publicUrl: null,
      enableSignup: true,
      // A pooled VM has no instance yet, so no model to pin. Empty means the
      // sidecar env omits DEFAULT_MODELS at bake; claim rewrites this whole file
      // with the real per-instance value before the admin account is seeded.
      model: "",
    })
    const envB64 = Buffer.from(
      Object.entries(placeholderEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      "utf8",
    ).toString("base64")
    sidecarWarm = `
echo "=== bake: open-webui warmup ==="
mkdir -p "$(dirname ${q(sc.envPath)})"
echo ${q(envB64)} | base64 -d > ${q(sc.envPath)}
chmod 600 ${q(sc.envPath)}
echo ${q(sidecarUnitB64)} | base64 -d > "/etc/systemd/system/${sc.serviceName}.service"
systemctl daemon-reload
systemctl enable ${q(sc.serviceName)} || true
systemctl start ${q(sc.serviceName)} || true
`
  }

  return `#!/bin/bash
set -uo pipefail
export SYSTEMD_PAGER=cat
${hermesWarm}
echo "=== bake: install gateway unit ==="
echo ${q(unitB64)} | base64 -d > "/etc/systemd/system/${runtime.serviceName}.service"
systemctl daemon-reload
systemctl enable ${q(runtime.serviceName)} || true
${sidecarWarm}
echo "=== bake: finalize done ==="
`
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
      await db
        .update(warmVms)
        .set({ status: "failed", lastError: `bootstrap ${status}` })
        .where(eq(warmVms.id, row.id))
      return { promotedReady: false }
    }
    if (status !== "done") return { promotedReady: false }

    // Bootstrap complete — run bake-finalize + capture the host fingerprint,
    // then mark ready. Failures here are non-fatal (best-effort warmup).
    try {
      await sshRunScript(target, buildBakeFinalizeScript(row.runtime as RuntimeId, row.webuiEnabled), {
        timeoutMs: 180_000,
      })
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
    if (!managedSubdomain && cloudflareDnsEnabled() && ip) {
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
      await deleteAgentSubdomain(row.id, row.cfRecordId)
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
  const reapCandidates = await db.query.warmVms.findMany({})
  for (const row of reapCandidates) {
    const created = row.createdAt?.getTime() ?? now
    const ready = row.readyAt?.getTime() ?? now
    const claimed = row.claimedAt?.getTime() ?? now
    const staleKey = !activeKeys.has(row.poolKey)
    const shouldReap =
      staleKey ||
      row.status === "failed" ||
      (["creating", "bootstrapping"].includes(row.status) && now - created > BOOTSTRAP_TTL_MS) ||
      (row.status === "ready" && now - ready > READY_MAX_AGE_MS) ||
      (row.status === "claimed" && now - claimed > CLAIMED_TTL_MS)
    if (!shouldReap) continue
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
  runtime: RuntimeId
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
export async function maybeRefillWarmPool(): Promise<void> {
  if (!isPoolEnabled()) return
  if (refillInFlight) {
    await refillInFlight.catch(() => {})
    return
  }
  if (Date.now() - lastRefillAt < REFILL_MIN_INTERVAL_MS) return
  lastRefillAt = Date.now()
  refillInFlight = refillWarmPoolLocked()
    .catch(() => {})
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
