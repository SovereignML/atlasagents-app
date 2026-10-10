/**
 * Make sure a box can serve its managed hostname over TLS that a Full (strict)
 * Cloudflare edge accepts, and say whether it can.
 *
 * This used to be a presence check (`sshVmHasCloudflareOriginCerts`) on a cert
 * the bootstrap may or may not have written, and three things were wrong with
 * that:
 *
 *  - **Warm-pool VMs never got one.** The pool bakes with no cert, so every
 *    agent delivered from the pool — the primary managed path — fell back to
 *    `tls internal`, which a Full (strict) zone rejects with a 526.
 *  - **It could not tell zones apart.** A box holding the old zone's cert
 *    would "pass" for a hostname in a new zone and serve a cert that does not
 *    cover it.
 *  - **The key rode in cloud-init user-data**, which any process on the
 *    droplet can read back from the metadata service — including the
 *    customer's agent.
 *
 * Installing the cert for the hostname's own zone, over SSH, right before the
 * Caddyfile is rendered fixes all three, on every path that renders one:
 * first provision (cold, pool or BYOS), reprovision, and domain changes.
 */

import type { SshTarget } from "@/lib/ssh"
import { sshInstallCloudflareOriginCert, sshVmHasCloudflareOriginCerts } from "@/lib/ssh"
import { originCertFor, zoneForHostname } from "@/lib/agent-zones"

export type OriginCertOutcome = {
  /** Render the managed site block with the origin cert (true) or `tls internal` (false). */
  useCfOriginTls: boolean
  /** The zone the hostname resolved to, for logging. */
  zone: string | null
  /** Set when a configured cert could not be installed; the caller logs it. */
  warning?: string
}

export async function ensureManagedOriginCert(
  target: SshTarget,
  managedSubdomain: string | null | undefined,
): Promise<OriginCertOutcome> {
  if (!managedSubdomain) return { useCfOriginTls: false, zone: null }
  const zone = zoneForHostname(managedSubdomain)
  // Throws on a malformed cert/key pair — deliberately, see originCertFor.
  const cert = zone ? originCertFor(zone) : null
  if (!cert) {
    // Nothing configured for this hostname's zone. Keep whatever the box
    // already has; that is exactly the old behaviour, and the zone must then
    // be in "Full" rather than "Full (strict)" for `tls internal` to work.
    return {
      useCfOriginTls: await sshVmHasCloudflareOriginCerts(target),
      zone: zone?.domain ?? null,
    }
  }
  const res = await sshInstallCloudflareOriginCert(target, cert.certPem, cert.keyPem)
  if (res.code === 0 || res.code === null) {
    return { useCfOriginTls: true, zone: zone!.domain }
  }
  return {
    useCfOriginTls: await sshVmHasCloudflareOriginCerts(target),
    zone: zone!.domain,
    warning: `Could not install the ${zone!.domain} origin certificate (exit ${res.code}): ${
      (res.stderr || res.stdout).trim().slice(0, 300)
    }`,
  }
}
