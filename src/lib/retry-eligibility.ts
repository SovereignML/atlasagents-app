// Whether a deployment may be retried. Kept free of DB/network so the decision
// matrix is unit-testable in isolation — the retry route does the lookup,
// supplies the TTL and the lock state, and calls this.

import { classifyProvisioning } from "./provision-liveness"

export type RetryProbe = {
  status: string
  /** When the row last changed status. Null on rows predating the column. */
  lastTransitionAt: Date | null
  createdAt: Date
  /**
   * How long a row may sit in `provisioning` before it counts as stalled.
   * Callers pass the reconciler's PROVISIONING_TTL_MS so the two never
   * disagree; it is a parameter rather than an import to keep this module free
   * of the reconciler's DB dependencies.
   */
  ttlMs: number
  /**
   * Whether the per-instance provisioning lock is held. `true` means a worker
   * is genuinely mid-provision and retry must be refused however old the row
   * looks; `false` means nothing is running it, so retry need not wait out the
   * TTL at all. `null`/omitted falls back to the age heuristic.
   */
  lockHeld?: boolean | null
  /** Injectable for tests. */
  now?: number
}

export type RetryDecision =
  | { ok: true; stalled: boolean }
  | { ok: false; reason: string }

/**
 * Decide whether a deployment can be retried.
 *
 * Two cases qualify:
 *
 *   - `failed_provisioning` — a clean failure, always retryable.
 *   - `provisioning` that has STALLED — the app restarted (or the process was
 *     killed) mid-provision, so the row says "in progress" while nothing is
 *     actually running. Before this existed, such a row was unrecoverable: the
 *     retry endpoint refused it and the only thing that would ever move it was
 *     the reconciler, which ran nightly.
 *
 * "Stalled" is decided by `classifyProvisioning`, the same helper the
 * reconciler uses, so the two can never disagree about whether a deploy is
 * dead. It prefers the advisory lock over age: a running provision holds that
 * lock for its whole duration and is never declared stalled, while a row whose
 * worker died holds no lock and becomes retryable in ~2 minutes instead of
 * after the (deliberately generous) TTL.
 */
export function decideRetryEligibility(probe: RetryProbe): RetryDecision {
  if (probe.status === "failed_provisioning") {
    return { ok: true, stalled: false }
  }

  if (probe.status === "provisioning") {
    const since = probe.lastTransitionAt ?? probe.createdAt
    const liveness = classifyProvisioning({
      ageMs: (probe.now ?? Date.now()) - since.getTime(),
      lockHeld: probe.lockHeld ?? null,
      ttlMs: probe.ttlMs,
    })
    if (liveness === "dead") {
      return { ok: true, stalled: true }
    }
    return {
      ok: false,
      reason: "This deployment is still in progress. Retry is available if it stalls.",
    }
  }

  return { ok: false, reason: `Cannot retry instance in ${probe.status} state` }
}
