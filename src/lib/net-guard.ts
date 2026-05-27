import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

/**
 * SSRF guard for user-supplied hosts we will connect to (e.g. BYOS SSH).
 *
 * A customer pastes a hostname/IP and we then SSH into it as root with the
 * fleet key. Without validation a user could point us at loopback, the cloud
 * metadata endpoint (169.254.169.254), or an RFC1918 neighbour and have the
 * platform connect on their behalf. We reject any address that isn't publicly
 * routable, resolving DNS names and re-checking every resolved IP to blunt
 * rebinding tricks.
 *
 * Set BYOS_HOST_ALLOWLIST (comma-separated hosts) to bypass the check for
 * trusted internal test targets.
 */

export class BlockedHostError extends Error {
  constructor(host: string, reason: string) {
    super(`Host "${host}" is not allowed: ${reason}`)
    this.name = "BlockedHostError"
  }
}

function allowlist(): Set<string> {
  return new Set(
    (process.env.BYOS_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Returns a reason string if the IP is not publicly routable, else null. */
export function privateIpReason(ip: string): string | null {
  const kind = isIP(ip)
  if (kind === 4) {
    const o = ip.split(".").map(Number)
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return "malformed IPv4 address"
    }
    const [a, b] = o
    if (a === 0) return "unspecified/this-network (0.0.0.0/8)"
    if (a === 10) return "private (10.0.0.0/8)"
    if (a === 127) return "loopback (127.0.0.0/8)"
    if (a === 169 && b === 254) return "link-local / cloud metadata (169.254.0.0/16)"
    if (a === 172 && b >= 16 && b <= 31) return "private (172.16.0.0/12)"
    if (a === 192 && b === 168) return "private (192.168.0.0/16)"
    if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT (100.64.0.0/10)"
    if (a >= 224) return "multicast/reserved (>=224.0.0.0)"
    return null
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    if (lower === "::1") return "loopback (::1)"
    if (lower === "::") return "unspecified (::)"
    if (lower.startsWith("fe80")) return "link-local (fe80::/10)"
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "unique-local (fc00::/7)"
    if (lower.startsWith("ff")) return "multicast (ff00::/8)"
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4 address.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return privateIpReason(mapped[1])
    return null
  }
  return "not a valid IP address"
}

/**
 * Throws BlockedHostError if `host` is empty, a private/loopback/link-local IP,
 * or a hostname that resolves to one. Allowlisted hosts pass unchecked.
 */
export async function assertPublicHost(host: string): Promise<void> {
  const trimmed = host.trim()
  if (!trimmed) throw new BlockedHostError(host, "empty host")
  if (allowlist().has(trimmed.toLowerCase())) return

  // Literal IP: validate directly.
  if (isIP(trimmed)) {
    const reason = privateIpReason(trimmed)
    if (reason) throw new BlockedHostError(trimmed, reason)
    return
  }

  // Hostname: resolve every A/AAAA record and reject if any is non-public.
  let records: { address: string }[]
  try {
    records = await lookup(trimmed, { all: true })
  } catch {
    throw new BlockedHostError(trimmed, "DNS resolution failed")
  }
  if (records.length === 0) throw new BlockedHostError(trimmed, "no DNS records")
  for (const { address } of records) {
    const reason = privateIpReason(address)
    if (reason) throw new BlockedHostError(trimmed, `resolves to ${address} — ${reason}`)
  }
}
