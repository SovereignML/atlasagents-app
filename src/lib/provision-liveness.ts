// Is a row sitting in `provisioning` actually being provisioned right now?
//
// Age alone cannot answer this, and treating it as if it could is a bug both
// the reconciler and the retry endpoint had:
//
//   - `provisionBot` holds a per-instance advisory lock for the WHOLE provision
//     (provisioner.ts, `withInstanceLock`), and a legitimate provision can run
//     far longer than the old 20-minute TTL. The managed path's bootstrap poll
//     alone budgets 20 minutes (`sshPollBootstrap`), and BYOS adds a 15-minute
//     bootstrap plus ~10 minutes of configure/health stages. So the reconciler
//     reclaimed deploys that were still working, and the later commit
//     transition then failed because the row was no longer `provisioning`.
//   - Conversely, a row whose process died holds NO lock, and waiting out a
//     TTL before letting the user retry is pure delay.
//
// The lock is the real signal; age is only the fallback for when we could not
// read it. Kept dependency-free (no DB) so the matrix is unit-testable.

/**
 * Grace for a row that holds no lock. A provision transitions the row to
 * `provisioning` and acquires the lock in separate statements, so there is a
 * brief legitimate window with a row and no lock yet. Short, because past it
 * the absence of a lock is conclusive.
 */
export const LOCKLESS_GRACE_MS = 2 * 60 * 1000 // 2 minutes

export type ProvisioningProbe = {
  /** How long the row has been in `provisioning`. */
  ageMs: number
  /**
   * Whether the per-instance advisory lock is held. `null` means we could not
   * determine it (probe threw / no DB) — fall back to age.
   */
  lockHeld: boolean | null
  /** Age past which a row with an unknown lock state counts as dead. */
  ttlMs: number
  locklessGraceMs?: number
}

/**
 * - `live`    — a worker is provisioning this. Never reclaim, never retry.
 * - `dead`    — nothing is running it. Safe to reclaim and to retry.
 * - `unknown` — we cannot tell and it is not old enough to assume. Leave alone.
 */
export type ProvisioningLiveness = "live" | "dead" | "unknown"

export function classifyProvisioning(probe: ProvisioningProbe): ProvisioningLiveness {
  const grace = probe.locklessGraceMs ?? LOCKLESS_GRACE_MS

  // A held lock is conclusive and beats any age. This is the case the old
  // age-only check got wrong.
  if (probe.lockHeld === true) return "live"

  if (probe.lockHeld === false) {
    // No lock and past the hand-off window: the worker is gone.
    return probe.ageMs > grace ? "dead" : "live"
  }

  // Lock state unknown — the pre-existing age heuristic, as a safety net only.
  return probe.ageMs > probe.ttlMs ? "dead" : "unknown"
}
