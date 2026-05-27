// Per-team white-label branding resolution (Node runtime only — imports @/db).
//
// Two entry points mirror the two ways a user reaches the dashboard:
//   • by team   — normal access on the canonical domain (active team)
//   • by host    — access via a team's verified custom domain
//
// Resolution always returns a fully-populated shape: stored white-label values
// merged over the default BRANDING constant. The entitlement gate is checked
// live here, so a team that downgrades below scale/enterprise silently reverts
// to the default look without its stored config being deleted.
//
// NEVER import this module from src/proxy.ts or any edge runtime — the pg pool
// in @/db is not edge-compatible. Host→team resolution happens in the dashboard
// layout server component (Node), not in middleware.

import { db, teamBranding, eq, and, isNotNull } from "@/db"
import { BRANDING } from "@/configs/branding"
import { teamHasWhiteLabel } from "@/lib/white-label"
import { normalizeHost, isCanonicalHost } from "@/lib/host"

// Re-exported for call sites that import host helpers from here.
export { normalizeHost, isCanonicalHost, normalizeCustomDomain, getCnameTarget } from "@/lib/host"

export type ResolvedBranding = {
  teamId: string | null
  brandName: string
  logoUrl: string | null
  logoMarkUrl: string | null
  faviconUrl: string | null
  supportEmail: string
  primaryLight: string | null
  accentLight: string | null
  primaryDark: string | null
  accentDark: string | null
  /** false → render the default SovereignML look (no overrides applied). */
  isWhiteLabel: boolean
}

/** The default, non-white-label branding (the SovereignML look). */
export function getDefaultBranding(): ResolvedBranding {
  return {
    teamId: null,
    brandName: BRANDING.name,
    logoUrl: null,
    logoMarkUrl: null,
    faviconUrl: null,
    supportEmail: BRANDING.supportEmail,
    primaryLight: null,
    accentLight: null,
    primaryDark: null,
    accentDark: null,
    isWhiteLabel: false,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Color validation (CSS-injection guard)
// ──────────────────────────────────────────────────────────────────────

// Accept #rgb / #rrggbb / #rrggbbaa and rgb()/rgba() with numeric components.
// Anything else (including CSS keywords, url(), expressions) is rejected so the
// value is safe to interpolate into a raw <style> tag.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGB_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/

/** True when `value` is a CSS color safe to emit into a <style> tag. */
export function isValidCssColor(value: string): boolean {
  return HEX_RE.test(value.trim()) || RGB_RE.test(value.trim())
}

/** Returns the trimmed color if valid, else null. */
export function sanitizeColor(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  return isValidCssColor(v) ? v : null
}

// ──────────────────────────────────────────────────────────────────────
// Resolution
// ──────────────────────────────────────────────────────────────────────

/**
 * Branding for an explicit team. Returns the default look when the team has no
 * branding row, has disabled branding, or is not currently entitled.
 */
export async function getTenantBrandingByTeam(
  teamId: string,
): Promise<ResolvedBranding> {
  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
  })
  if (!row || !row.brandingEnabled) return getDefaultBranding()
  if (!(await teamHasWhiteLabel(teamId))) return getDefaultBranding()

  const d = getDefaultBranding()
  return {
    teamId,
    brandName: row.brandName?.trim() || d.brandName,
    logoUrl: row.logoUrl || null,
    logoMarkUrl: row.logoMarkUrl || null,
    faviconUrl: row.faviconUrl || null,
    supportEmail: row.supportEmail?.trim() || d.supportEmail,
    primaryLight: sanitizeColor(row.primaryLight),
    accentLight: sanitizeColor(row.accentLight),
    primaryDark: sanitizeColor(row.primaryDark),
    accentDark: sanitizeColor(row.accentDark),
    isWhiteLabel: true,
  }
}

/**
 * Resolves a request Host header to a team id, but ONLY for a verified custom
 * domain. Returns null for the canonical app host or any unknown/unverified
 * host (caller then uses the default look / active-team path).
 */
export async function resolveTeamByHost(
  host: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizeHost(host)
  if (!normalized) return null
  if (isCanonicalHost(normalized)) return null

  const row = await db.query.teamBranding.findFirst({
    where: and(
      eq(teamBranding.customDomain, normalized),
      isNotNull(teamBranding.domainVerifiedAt),
    ),
    columns: { teamId: true },
  })
  return row?.teamId ?? null
}

/** Branding for a request Host header (custom-domain path). */
export async function getTenantBrandingByHost(
  host: string | null | undefined,
): Promise<ResolvedBranding> {
  const teamId = await resolveTeamByHost(host)
  if (!teamId) return getDefaultBranding()
  return getTenantBrandingByTeam(teamId)
}

// ──────────────────────────────────────────────────────────────────────
// Theme CSS
// ──────────────────────────────────────────────────────────────────────

/**
 * Builds the scoped CSS-variable overrides for a white-label team, targeting
 * the existing `.app-shell` scope (dashboard only) — never global `:root`.
 * Only emits variables the team actually set; values are pre-validated colors,
 * so the result is safe to inject into a server-rendered <style> tag.
 */
export function buildBrandingCss(b: ResolvedBranding): string {
  if (!b.isWhiteLabel) return ""

  const light: string[] = []
  if (b.primaryLight) {
    light.push(`--primary:${b.primaryLight}`, `--sidebar-primary:${b.primaryLight}`)
  }
  const lightRing = b.accentLight ?? b.primaryLight
  if (lightRing) light.push(`--ring:${lightRing}`, `--sidebar-ring:${lightRing}`)

  const dark: string[] = []
  if (b.primaryDark) {
    dark.push(`--primary:${b.primaryDark}`, `--sidebar-primary:${b.primaryDark}`)
  }
  const darkRing = b.accentDark ?? b.primaryDark
  if (darkRing) dark.push(`--ring:${darkRing}`, `--sidebar-ring:${darkRing}`)

  const out: string[] = []
  if (light.length) out.push(`.app-shell{${light.join(";")}}`)
  if (dark.length) out.push(`.dark .app-shell{${dark.join(";")}}`)
  return out.join("")
}
