// Pure request-host helpers (no DB imports) — safe to use anywhere, including
// surfaces that shouldn't pull in the Postgres pool (e.g. the login page).

import { BRANDING } from "@/configs/branding"

// A valid public hostname (subdomain or apex): labels of a-z0-9/hyphen, at
// least one dot, a 2+ char alpha TLD, ≤253 chars total.
const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

/** Strip port, lowercase, trim. Returns null for empty/invalid input. */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  const h = host.trim().toLowerCase().split(":")[0]
  return h || null
}

/**
 * Hosts that are NOT custom domains (the platform's own domain + local dev).
 *
 * Includes BRANDING.legacyDomains: the pre-rename hosts still resolve here and
 * must not be claimable as tenant white-label domains.
 */
export function isCanonicalHost(host: string): boolean {
  return canonicalHosts().has(host)
}

function canonicalHosts(): Set<string> {
  const hosts = new Set<string>(["localhost", "127.0.0.1"])
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).hostname.toLowerCase())
    } catch {
      /* ignore malformed env */
    }
  }
  const domain = BRANDING.domain.toLowerCase()
  hosts.add(domain)
  hosts.add(`www.${domain}`)
  for (const host of [...BRANDING.legacyHosts.site, ...BRANDING.legacyHosts.app]) {
    hosts.add(host.toLowerCase())
  }
  return hosts
}

/**
 * Normalizes user-entered custom-domain input (strips scheme/path/port,
 * lowercases) and validates it as a hostname. Returns null when invalid or when
 * it is the platform's own canonical host (which can't be claimed).
 */
export function normalizeCustomDomain(input: string): string | null {
  let host = input.trim().toLowerCase()
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  host = host.split(":")[0]
  if (!host || !HOSTNAME_RE.test(host)) return null
  if (isCanonicalHost(host)) return null
  return host
}

/**
 * The CNAME target customers point their custom domain at. With Cloudflare for
 * SaaS this must be the SaaS fallback-origin / custom-hostname target (set
 * WHITELABEL_CNAME_TARGET to it), NOT the app host directly — Cloudflare's edge
 * terminates TLS for the customer hostname and proxies to our origin.
 */
export function getCnameTarget(): string {
  const explicit = process.env.WHITELABEL_CNAME_TARGET
  if (explicit) return explicit
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      return new URL(appUrl).hostname
    } catch {
      /* ignore */
    }
  }
  return `cname.${BRANDING.domain}`
}
