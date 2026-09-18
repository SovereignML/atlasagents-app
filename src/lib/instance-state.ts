// Instance state machine — the single source of truth for legal transitions.
//
// DB state is authoritative. Every status mutation must go through
// `transitionInstance()` so that we can:
//   1. Reject illegal transitions atomically (DB UPDATE with status IN (from)).
//   2. Stamp lastTransitionAt / attempt counters / lastError consistently.
//   3. Keep a single grep target for "where can status change?".

import { db, instances, instanceLogs, eq, and, inArray, sql } from "@/db"

export const INSTANCE_STATES = [
  "pending",
  "provisioning",
  "running",
  "stopped",
  "failed_provisioning",
  /** Legacy / external rows — same semantics as failed deploy; only legal exit is delete */
  "failed",
  "deleting",
  "deleted",
] as const
export type InstanceState = (typeof INSTANCE_STATES)[number]

// Legal transitions. Source of truth — anything not listed here is rejected.
const TRANSITIONS: Record<InstanceState, InstanceState[]> = {
  pending: ["provisioning", "failed_provisioning", "deleting"],
  provisioning: ["running", "failed_provisioning", "deleting"],
  running: ["stopped", "deleting"],
  stopped: ["running", "deleting"],
  failed_provisioning: ["deleting", "provisioning"],
  failed: ["deleting"],
  deleting: ["deleted", "failed_provisioning"],
  deleted: [],
}

export function canTransition(from: InstanceState, to: InstanceState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function legalPredecessors(to: InstanceState): InstanceState[] {
  return INSTANCE_STATES.filter((s) => canTransition(s, to))
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly instanceId: string,
    public readonly to: InstanceState,
    public readonly expectedFrom: readonly InstanceState[],
  ) {
    super(
      `Illegal transition for instance ${instanceId} → ${to}. ` +
        `Expected current state in [${expectedFrom.join(", ")}].`,
    )
    this.name = "IllegalTransitionError"
  }
}

type TransitionOpts = {
  /** Extra columns to set in the same UPDATE (e.g. ipAddress, vmId). */
  set?: Record<string, unknown>
  /** Appended to lastError; cleared when omitted and transition is to a
   *  non-failure state. */
  error?: string | null
  /** Increment provisionAttempts or deletionAttempts by 1. */
  bumpAttempts?: "provision" | "deletion"
}

/**
 * Atomically transition an instance. Returns the updated row.
 *
 * Uses `UPDATE ... WHERE status IN (from)` so two concurrent transitions
 * cannot both succeed — the loser sees 0 rows updated and throws.
 */
export async function transitionInstance(
  instanceId: string,
  from: InstanceState | InstanceState[],
  to: InstanceState,
  opts: TransitionOpts = {},
) {
  const fromStates = Array.isArray(from) ? from : [from]
  // OR semantics: callers pass multiple possible *current* statuses (e.g. delete from
  // running OR stopped). Only states with a legal edge to `to` participate in the UPDATE.
  // Do NOT require every listed state to reach `to` — e.g. provisioning cannot → deleting,
  // but running can; including both in `from` must not throw before the UPDATE.
  const legalSources = fromStates.filter((f) => canTransition(f, to))
  if (legalSources.length === 0) {
    throw new IllegalTransitionError(instanceId, to, fromStates)
  }

  const set: Record<string, unknown> = {
    ...opts.set,
    status: to,
    lastTransitionAt: new Date(),
  }

  if (to === "deleted") {
    set.deletedAt = new Date()
  }

  if (opts.error !== undefined) {
    set.lastError = opts.error
  } else if (to === "running" || to === "deleted") {
    // Clear stale error text on a clean success.
    set.lastError = null
  }

  if (opts.bumpAttempts === "provision") {
    set.provisionAttempts = sql`${instances.provisionAttempts} + 1`
  } else if (opts.bumpAttempts === "deletion") {
    set.deletionAttempts = sql`${instances.deletionAttempts} + 1`
  }

  const updated = await db
    .update(instances)
    .set(set)
    .where(and(eq(instances.id, instanceId), inArray(instances.status, legalSources)))
    .returning()

  if (updated.length === 0) {
    const current = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
      columns: { status: true },
    })
    console.warn(
      `[instance-state] transition rejected for ${instanceId}: current=${current?.status ?? "missing"} → ${to}`,
    )
    throw new IllegalTransitionError(instanceId, to, legalSources)
  }

  return updated[0]
}

/**
 * Advisory-lock-guarded section. Guarantees only one worker runs `fn` for a
 * given instance at a time, even across multiple Node processes.
 *
 * Uses a transaction + `pg_try_advisory_xact_lock`. If another worker holds
 * the lock, returns `{ acquired: false }` without waiting. Callers decide
 * whether to retry or abort.
 */
export async function withInstanceLock<T>(
  instanceId: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  return await db.transaction(async (tx) => {
    const got = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${instanceId}, 0)) AS locked`,
    )
    // node-postgres returns { rows: [...] }; drizzle exposes .rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (got as any).rows?.[0] as { locked?: boolean } | undefined
    if (!row?.locked) return { acquired: false }
    const result = await fn()
    return { acquired: true, result }
  })
}

/**
 * Is another worker holding this instance's provisioning lock right now?
 *
 * Implemented as a try-acquire: if we get the lock, nobody held it. The lock is
 * an `xact` lock, so it is released the moment this probe's transaction ends —
 * acquiring it here cannot block a provision that starts a millisecond later.
 *
 * Returns `null` when the probe itself fails, so callers can tell "not held"
 * apart from "could not tell" instead of treating a database blip as a dead
 * deploy. See `classifyProvisioning` in provision-liveness.ts.
 */
export async function isInstanceLockHeld(instanceId: string): Promise<boolean | null> {
  try {
    const probe = await withInstanceLock(instanceId, async () => true)
    return !probe.acquired
  } catch {
    return null
  }
}

/**
 * Best-effort: drive a still-non-terminal instance to `failed_provisioning`.
 *
 * The target-specific provisioners already mark failed via `rollbackProvisioning`,
 * but failures that throw earlier (the dev/mock path, an error before a target
 * function runs) would otherwise leave the row stuck in `provisioning` until the
 * reconciler TTL reclaims it ~20 min later. This closes that window. It is a
 * no-op — with no illegal-transition noise — when the row is already terminal or
 * running, so calling it on top of an already-handled failure is safe.
 */
export async function ensureProvisioningFailed(
  instanceId: string,
  error: string,
): Promise<void> {
  const row = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { status: true },
  })
  if (row?.status !== "pending" && row?.status !== "provisioning") return
  try {
    await transitionInstance(instanceId, [row.status], "failed_provisioning", { error })
  } catch {
    // Raced with another writer (e.g. rollbackProvisioning) — the status is no
    // longer ours to set, which is the desired end state anyway.
  }
}

/**
 * Structured log writer. All provisioner/reconciler/delete paths should use
 * this instead of `db.insert(instanceLogs).values({...})` directly, so
 * downstream log consumers get a consistent shape.
 */
export async function logInstanceEvent(params: {
  instanceId: string
  level?: "info" | "warn" | "error"
  message: string
  stage?: string
  action?: string
  result?: "ok" | "error"
  durationMs?: number
  detail?: unknown
}) {
  await db.insert(instanceLogs).values({
    instanceId: params.instanceId,
    level: params.level ?? "info",
    message: params.message,
    stage: params.stage,
    action: params.action,
    result: params.result,
    durationMs: params.durationMs,
    detail: params.detail as never,
  })
  // Mirror to stdout as JSON for log aggregators (CloudWatch / Vercel).
  console.log(
    JSON.stringify({
      kind: "instance_event",
      instanceId: params.instanceId,
      level: params.level ?? "info",
      stage: params.stage,
      action: params.action,
      result: params.result,
      durationMs: params.durationMs,
      message: params.message,
    }),
  )
}
