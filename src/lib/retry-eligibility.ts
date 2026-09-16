// Whether a deployment may be retried. Kept dependency-free (no DB, no network,
// no imports) so the decision matrix is unit-testable in isolation — the retry
// route does the lookup, supplies the TTL, and calls this.

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
 * "Stalled" reuses the reconciler's TTL deliberately: past that threshold the
 * reconciler would reclaim and tear the row down anyway, so allowing a
 * user-initiated retry at the same point is no more aggressive than the status
 * quo — and it cannot race a live provision, because a genuinely running one
 * holds the instance lock and `provisionBot` rejects a second entrant.
 */
export function decideRetryEligibility(probe: RetryProbe): RetryDecision {
  if (probe.status === "failed_provisioning") {
    return { ok: true, stalled: false }
  }

  if (probe.status === "provisioning") {
    const since = probe.lastTransitionAt ?? probe.createdAt
    const age = (probe.now ?? Date.now()) - since.getTime()
    if (age > probe.ttlMs) {
      return { ok: true, stalled: true }
    }
    return {
      ok: false,
      reason: "This deployment is still in progress. Retry is available if it stalls.",
    }
  }

  return { ok: false, reason: `Cannot retry instance in ${probe.status} state` }
}
