// Cloudflare for SaaS — Custom Hostnames. This is how white-label tenant
// dashboard domains get TLS, replacing the old Caddy on-demand-TLS box.
//
// The platform registers each tenant custom hostname on a SaaS-enabled zone
// (CLOUDFLARE_SAAS_ZONE_ID). Cloudflare terminates TLS at its edge and proxies
// to our fallback origin (WHITELABEL_FALLBACK_ORIGIN). The app still receives
// the original Host header, so src/lib/tenant-branding.ts `resolveTeamByHost`
// maps it to a team unchanged. Customers point a CNAME at the SaaS target
// (src/lib/host.ts `getCnameTarget`).
//
// Reuses the low-level cfFetch plumbing + platform token from src/lib/cloudflare.ts.

import { cfFetch, type CfCtx } from "./cloudflare"

/** The SaaS-enabled zone that custom hostnames are registered against. */
export function saasZoneId(): string {
  const z = process.env.CLOUDFLARE_SAAS_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID
  if (!z) {
    throw new Error("CLOUDFLARE_SAAS_ZONE_ID (or CLOUDFLARE_ZONE_ID) is not set")
  }
  return z
}

/** True when the platform has what it needs to manage custom hostnames. */
export function cfSaasConfigured(): boolean {
  return Boolean(
    (process.env.CLOUDFLARE_SAAS_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID) &&
      process.env.CLOUDFLARE_API_TOKEN,
  )
}

// Token falls back to the platform CLOUDFLARE_API_TOKEN inside cfFetch; we only
// need to pin the zone here.
function ctx(): CfCtx {
  return { zoneId: saasZoneId() }
}

export type CustomHostnameSsl = {
  // "initializing" | "pending_validation" | "pending_issuance" |
  // "pending_deployment" | "active" | "expired" | ...
  status?: string
  validation_errors?: { message: string }[]
}

export type CustomHostname = {
  id: string
  hostname: string
  // "pending" | "pending_deletion" | "active" | "blocked" | "moved" | ...
  status: string
  ssl: CustomHostnameSsl
}

/**
 * Register a custom hostname. DV cert via HTTP validation (no extra TXT for the
 * customer beyond the CNAME). Idempotent-ish: Cloudflare returns the existing
 * record if the hostname is already registered, but callers should prefer
 * `findCustomHostnameByName` first to avoid duplicates.
 */
export async function createCustomHostname(hostname: string): Promise<CustomHostname> {
  return cfFetch<CustomHostname>(
    `/zones/${saasZoneId()}/custom_hostnames`,
    {
      method: "POST",
      body: JSON.stringify({
        hostname,
        ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
      }),
    },
    ctx(),
  )
}

export async function getCustomHostname(id: string): Promise<CustomHostname> {
  return cfFetch<CustomHostname>(
    `/zones/${saasZoneId()}/custom_hostnames/${id}`,
    {},
    ctx(),
  )
}

export async function deleteCustomHostname(id: string): Promise<void> {
  await cfFetch(`/zones/${saasZoneId()}/custom_hostnames/${id}`, { method: "DELETE" }, ctx())
}

export async function findCustomHostnameByName(
  hostname: string,
): Promise<CustomHostname | null> {
  const list = await cfFetch<CustomHostname[]>(
    `/zones/${saasZoneId()}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
    {},
    ctx(),
  )
  const lower = hostname.toLowerCase()
  return (list ?? []).find((h) => h.hostname.toLowerCase() === lower) ?? null
}

/**
 * Map a Cloudflare custom hostname into our existing teamBranding status shape.
 * `active` means the cert is live → the domain serves and ownership is proven.
 */
export function mapCustomHostnameStatus(ch: CustomHostname): {
  dnsStatus: "pending" | "ready"
  tlsStatus: "pending" | "issued"
  active: boolean
} {
  const sslActive = ch.ssl?.status === "active"
  const hostActive = ch.status === "active"
  const active = sslActive && hostActive
  return {
    dnsStatus: hostActive ? "ready" : "pending",
    tlsStatus: sslActive ? "issued" : "pending",
    active,
  }
}
