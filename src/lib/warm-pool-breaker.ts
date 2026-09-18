// Circuit breaker for warm-pool creates.
//
// The pool had no memory of failure. A VM whose bake failed was marked
// `failed`, reaped on the next 60s pass (the reap rule for a failed row has no
// grace), and the create step then saw a deficit and made another one — so a
// systematically broken bake (a bad package, an OOM on the pool plan, a
// provider quota) became an endless create → fail → destroy → create loop,
// each lap billing a real VM for however long the bake took to die. Nothing in
// the loop escalated, and because the pool never reached `ready`, deploys
// silently fell back to the slow path the whole time.
//
// So: count recent bake failures per pool key and stop creating for that key
// once they pile up. Pure functions (no clock, no state of its own) so the
// policy is unit-testable; warm-pool.ts owns the state.

/** How far back a failure counts against a pool key. */
export const FAILURE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

/**
 * Failures within the window before creates stop. Three lets a genuinely
 * transient problem (one bad mirror fetch, one unlucky provider hiccup) heal
 * itself, while catching anything systematic within ~3 bakes instead of
 * indefinitely.
 */
export const MAX_FAILURES_PER_WINDOW = 3

/**
 * Below this age, destroying a pool VM means the pool is churning rather than
 * working — whatever the stated reason.
 *
 * A healthy warm VM is destroyed for exactly two reasons: the 3-day `ready`
 * recycle, or a config change that retires its pool key. Both act on VMs that
 * have been alive for hours at minimum. A *successful* bake alone takes several
 * minutes (apt, a Node install, an npm install), so a VM torn down inside 15
 * minutes never had a chance to become useful, and we paid for it anyway.
 *
 * This exists because counting only bake failures was too narrow. The original
 * money leak was a create → fail → destroy → create loop, and the breaker
 * caught that shape — but any *other* loop shape (a pool key that create and
 * reap disagree about, a new reap rule that fires too eagerly, a provider that
 * reports a VM as gone) would churn just as expensively while the failure
 * counter sat at zero. Age is the shape-independent signal: whatever the
 * reason, a VM that dies this young is waste.
 */
export const MIN_VIABLE_AGE_MS = 15 * 60 * 1000 // 15 min

/** Failure timestamps (ms) for one pool key, oldest first. */
export type BreakerState = readonly number[]

export type BreakerOpts = {
  windowMs?: number
  maxFailures?: number
}

/** Drop failures that have aged out of the window. */
export function pruneFailures(
  state: BreakerState,
  now: number,
  opts: BreakerOpts = {},
): number[] {
  const windowMs = opts.windowMs ?? FAILURE_WINDOW_MS
  return state.filter((t) => now - t < windowMs)
}

/** Record a failure, returning the pruned-and-appended state. */
export function recordFailure(
  state: BreakerState,
  now: number,
  opts: BreakerOpts = {},
): number[] {
  return [...pruneFailures(state, now, opts), now]
}

/**
 * Is the circuit open — i.e. should we stop creating for this pool key?
 *
 * Open once the in-window failure count reaches the threshold. It closes on its
 * own as failures age out of the window, so a pool that was broken and has been
 * fixed refills without anyone intervening.
 */
export function isCircuitOpen(
  state: BreakerState,
  now: number,
  opts: BreakerOpts = {},
): boolean {
  const maxFailures = opts.maxFailures ?? MAX_FAILURES_PER_WINDOW
  return pruneFailures(state, now, opts).length >= maxFailures
}

/** When the oldest in-window failure expires, i.e. when the circuit can close. */
export function retryAfterMs(
  state: BreakerState,
  now: number,
  opts: BreakerOpts = {},
): number {
  const windowMs = opts.windowMs ?? FAILURE_WINDOW_MS
  const live = pruneFailures(state, now, opts)
  if (live.length === 0) return 0
  return Math.max(0, live[0] + windowMs - now)
}

/** Operator-facing explanation for a paused pool key. */
export function describeOpenCircuit(
  poolKey: string,
  state: BreakerState,
  now: number,
  opts: BreakerOpts = {},
): string {
  const count = pruneFailures(state, now, opts).length
  const mins = Math.ceil(retryAfterMs(state, now, opts) / 60_000)
  return (
    `warm-pool creates paused for ${poolKey}: ${count} bake failure(s) in the last hour. ` +
    `Not creating more VMs for ~${mins}m. The failing step + bootstrap.log tail for each ` +
    `failure is in OrphanEvent (action="failed", detail) and in the [warm-pool] stderr lines — ` +
    `NOT in WarmVm, whose rows the reaper deletes seconds after they fail.`
  )
}

/** Everything a reaped bake failure needs to explain itself, minus the clock. */
export type BakeFailureFacts = {
  poolKey: string
  /** Provider VM id, or null when the provider never gave us one. */
  vmId: string | null
  /** Lifecycle status the row died in: "failed", "creating", "bootstrapping". */
  status: string
  /** Row creation time in ms, or null if unknown. */
  createdAtMs: number | null
  /** The evidence: lastError (log tail included) or a hung-bake probe result. */
  reason: string
}

/**
 * The durable record of one failed bake.
 *
 * Pure, and deliberately in this module rather than warm-pool.ts: it is the one
 * artifact that survives the row. The reaper destroys a failed WarmVm within
 * ~60s, so whatever this string omits is gone for good — hence the pool key (is
 * it one runtime or all of them?), the VM id (cross-reference the provider
 * bill), how long the bake survived (died instantly vs. timed out), and the
 * reason itself.
 */
export function describeBakeFailure(facts: BakeFailureFacts, now: number): string {
  const ageSec =
    facts.createdAtMs == null ? "?" : String(Math.max(0, Math.round((now - facts.createdAtMs) / 1000)))
  return (
    `warm-pool bake failed: poolKey=${facts.poolKey} vmId=${facts.vmId ?? "(none)"} ` +
    `status=${facts.status} age=${ageSec}s\n${facts.reason}`
  )
}

/**
 * Was this VM destroyed so young that its existence was pure waste?
 *
 * `createdAtMs` null (unknown age) returns false: an unknown age is not
 * evidence of churn, and the breaker must not open on a guess.
 */
export function isChurnedVm(
  createdAtMs: number | null,
  destroyedAtMs: number,
  minViableAgeMs = MIN_VIABLE_AGE_MS,
): boolean {
  if (createdAtMs == null) return false
  return destroyedAtMs - createdAtMs < minViableAgeMs
}
