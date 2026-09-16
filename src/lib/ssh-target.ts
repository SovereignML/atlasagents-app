// How to reach an instance's host over SSH.
//
// This existed in four hand-copied variants (provisioner.sshTargetFor,
// server-metrics.targetFor, instance-files.sshTargetForInstance, and inline in
// provisionByosBot) — and instance-ingress.ts had none at all, so it always
// connected root@host:22. For a BYOS box on a custom port or a non-root user
// that meant custom domains silently failed while everything else worked.
//
// Kept dependency-free (structural input, type-only SshTarget import) so the
// metrics cron and route handlers can use it without dragging in the
// provisioner's module graph.

import type { SshTarget } from "@/lib/ssh"

/** The subset of an instance row this needs. Structural so any query shape fits. */
export type SshTargetFields = {
  id: string
  deploymentTarget: string | null
  ipAddress: string | null
  byosHost: string | null
  byosPort: number | null
  byosUser: string | null
}

/**
 * Resolve the host we connect to. BYOS prefers the customer-supplied hostname
 * over the recorded IP (the two can diverge when the host is a DNS name);
 * everything else is the provisioned VM's address. Null when there is no host
 * yet — callers decide whether that is an error or a skip.
 */
export function sshHostForInstance(instance: SshTargetFields): string | null {
  if (instance.deploymentTarget === "byos") {
    return instance.byosHost ?? instance.ipAddress ?? null
  }
  return instance.ipAddress ?? null
}

/**
 * Build the SSH target for an instance. `instanceId` is always set so every
 * connection is checked against the pinned host key (TOFU).
 *
 * Note this does NOT set `elevate`: whether a non-root BYOS user needs sudo is
 * resolved live per connection (`resolveElevation`), because it is a property
 * of the login, not of the row.
 */
export function sshTargetForInstance(instance: SshTargetFields): SshTarget {
  const target: SshTarget = {
    host: sshHostForInstance(instance) ?? "",
    instanceId: instance.id,
  }
  if (instance.deploymentTarget === "byos") {
    target.port = instance.byosPort ?? 22
    target.username = instance.byosUser ?? "root"
  }
  return target
}
