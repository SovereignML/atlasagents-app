// Installing an agent onto an already-connected BYOS server.
//
// An agent is never given a raw host any more: the customer connects a server
// first (free, see byos-server.ts), and installing picks one of those. This
// module holds the pure half of that — which server rows can take an agent, and
// what an instance row has to record about the one it lands on.
//
// Kept dependency-free (no db, no network) so it can be unit-tested, matching
// byos-preflight-parse.ts.

/** The subset of a ByosServer row this needs. Structural so any query shape fits. */
export type InstallableServer = {
  id: string
  host: string
  port: number
  sshUser: string
  status: string
}

/**
 * The instance columns that record which server an agent runs on.
 *
 * `byosServerId` is the real link; the three `byos*` columns beside it are
 * denormalized copies of the connection, because the provisioner, the metrics
 * cron and the SSH target helper all read them off the instance row. Writing
 * only one of the two halves is what previously left every installed agent
 * unattached to the server it was installed on — `agentCount`, the idle-server
 * cap and the disconnect guard all read `byosServerId` and so all saw zero.
 */
export function byosConnectionFields(server: InstallableServer): {
  byosServerId: string
  byosHost: string
  byosPort: number
  byosUser: string
} {
  return {
    byosServerId: server.id,
    byosHost: server.host,
    byosPort: server.port,
    byosUser: server.sshUser,
  }
}

/**
 * Why this server can't take an agent right now, or null if it can.
 *
 * Only a server we know to be unreachable is refused, and the message says how
 * to clear it: the snapshot can be stale (the box may have been down at the
 * last probe and fine now), so the fix is a re-probe, not a dead end. A server
 * still in "connecting" is not blocked — that state just means we haven't
 * finished the first probe.
 */
export function installBlockedReason(server: InstallableServer): string | null {
  if (server.status === "unreachable") {
    return "We can't reach this server right now. Refresh it from your server list, then try again."
  }
  return null
}

/**
 * Does the PLATFORM own the machine this agent runs on — i.e. may we create,
 * claim from the warm pool, or destroy it?
 *
 * True for "vps" and the legacy "shared" cluster. **False for "byos": that
 * machine belongs to the customer.** This is the line the warm pool must never
 * cross. The pool's whole failure mode is a create → fail → destroy loop, and
 * the one place that loop would be unrecoverable is against hardware we do not
 * own — so the VM-acquisition path asserts on this rather than trusting that
 * provisionBotLocked's routing (byos → provisionByosBot) will never be
 * refactored. BYOS teardown is correspondingly a systemd stop + rm -rf of the
 * install dir, never a deleteVM.
 */
export function platformOwnsHostVm(deploymentTarget: string | null | undefined): boolean {
  // Normalized before comparing, and deliberately asymmetric: anything that
  // *reads as* byos is treated as customer-owned, while an unknown or null
  // target stays platform-owned. Both directions fail in the recoverable
  // direction — a mis-cased "BYOS" that slipped past the writer would strand one
  // agent, whereas the same value read as platform-owned would authorize
  // deleting a customer's server. A legacy row with no target, by contrast, is
  // on our own infrastructure and must still be provisionable.
  return deploymentTarget?.trim().toLowerCase() !== "byos"
}
