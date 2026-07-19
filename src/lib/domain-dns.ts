/**
 * Hostname format checks + DNS lookups used when binding a DIY custom domain.
 * NS lookup walks parents until an apex with nameservers is found (so
 * `agent.example.com` validates via `example.com`'s NS).
 */

import dns from "node:dns/promises"

const HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function normalizeHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
}

export function isValidHostname(raw: string): boolean {
  const host = normalizeHostname(raw)
  return HOST_RE.test(host)
}

export type NsLookupResult =
  | { ok: true; host: string; apex: string; nameservers: string[] }
  | { ok: false; host: string; error: string }

/**
 * Confirm the hostname (or a parent) has public NS records — catches typos
 * and unregistered names before we rewrite Caddy / ask the user for an A record.
 */
export async function lookupDomainNs(raw: string): Promise<NsLookupResult> {
  const host = normalizeHostname(raw)
  if (!isValidHostname(host)) {
    return { ok: false, host, error: "Invalid domain format" }
  }

  const labels = host.split(".")
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join(".")
    try {
      const nameservers = await dns.resolveNs(candidate)
      if (nameservers.length > 0) {
        return { ok: true, host, apex: candidate, nameservers }
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      // ENOTFOUND / ENODATA → try parent. Other errors (timeout, SERVFAIL) surface.
      if (code === "ENOTFOUND" || code === "ENODATA") {
        continue
      }
      if (code === "ESERVFAIL" || code === "ETIMEOUT") {
        return {
          ok: false,
          host,
          error: `DNS lookup failed for ${candidate} (${code}). Try again in a moment.`,
        }
      }
      // Keep walking for other "no answer" style failures.
      continue
    }
  }

  return {
    ok: false,
    host,
    error: `No nameservers found for “${host}”. Check the spelling or register the domain first.`,
  }
}

/** Resolve A records for a hostname; empty array when NXDOMAIN / no data. */
export async function lookupDomainA(raw: string): Promise<string[]> {
  const host = normalizeHostname(raw)
  if (!isValidHostname(host)) return []
  try {
    return await dns.resolve4(host)
  } catch {
    return []
  }
}
