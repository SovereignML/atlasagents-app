// How a provisioning rollback should be logged. Kept dependency-free (no DB, no
// network) so it can be unit-tested in isolation — the provisioner imports it.

export type RollbackVmOutcome = {
  level: "warn" | "error"
  action: "no_vm" | "vm_deleted" | "orphan_pending"
  result: "ok" | "error"
  message: string
}

/**
 * Decide how a rollback should be logged, given whether a VM ever existed and
 * whether we managed to delete it.
 *
 * Three outcomes:
 *   • no vmId at all — nothing was ever created (BYOS, or a failure before VM
 *     create). There is no orphan and nothing for the reconciler to sweep, so
 *     we must NOT claim "VM undefined still exists — awaiting reconciler".
 *   • vmId deleted   — clean rollback.
 *   • vmId survived  — orphan; the reconciler's failed-cleanup pass retries.
 */
export function rollbackVmOutcome(
  vmId: string | undefined,
  vmDeleted: boolean,
): RollbackVmOutcome {
  if (!vmId) {
    return {
      level: "warn",
      action: "no_vm",
      result: "ok",
      message: "Rollback complete. No VM was created — nothing to clean up.",
    }
  }
  if (vmDeleted) {
    return {
      level: "warn",
      action: "vm_deleted",
      result: "ok",
      message: `Rollback complete. VM ${vmId} deleted.`,
    }
  }
  return {
    level: "error",
    action: "orphan_pending",
    result: "error",
    message: `Rollback incomplete. VM ${vmId} still exists — awaiting reconciler.`,
  }
}
