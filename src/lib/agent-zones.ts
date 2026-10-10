/**
 * The Cloudflare zones that managed agent hostnames live in.
 *
 * Every managed agent gets `<name>.<zone>`: an A record in a platform-owned
 * Cloudflare zone, proxied through the edge, with a Cloudflare Origin CA cert
 * on the box so the zone can run in Full (strict). That zone has always been
 * `sovereignclaw.xyz`.
 *
 * Moving to a new zone cannot be a rename. Every running agent has a hostname,
 * a DNS record and an origin cert in the old zone, and customers have those
 * URLs bookmarked and wired into bots. So there are two zones for as long as
 * any agent still lives in the old one:
 *
 *  - the **agent zone** (`CLOUDFLARE_AGENT_*`), where NEW agents are created,
 *    once it is configured;
 *  - the **legacy zone** (`CLOUDFLARE_BASE_DOMAIN` / `CLOUDFLARE_ZONE_ID` /
 *    `CLOUDFLARE_ORIGIN_CERT_*`, i.e. the variables that always described the
 *    agent zone), which keeps serving, renewing and deleting what it already
 *    holds.
 *
 * Which zone an existing agent belongs to is read off its stored hostname,
 * never off configuration, so changing configuration can never re-home an
 * agent that already exists.
 *
 * The legacy variables keep their exact meaning on purpose: `CLOUDFLARE_ZONE_ID`
 * is also the fallback zone for white-label custom hostnames
 * (cloudflare-saas.ts), so repointing it at a new zone would quietly move that
 * too. See docs/REBRAND-LEGACY-IDENTIFIERS.md for the cutover runbook.
 *
 * Pure: reads an env object, never the network, so it is unit-testable.
 */

import { X509Certificate, createPrivateKey, type KeyObject } from "node:crypto"
import { isValidPem, normalizePem } from "@/lib/pem"

// LEGACY WIRE FORMAT — the agent zone every existing agent was created in.
// Still the default when no new zone is configured, and still the zone those
// agents' DNS records and origin certs live in afterwards.
// See docs/REBRAND-LEGACY-IDENTIFIERS.md.
export const LEGACY_AGENT_DOMAIN = "sovereignclaw.xyz"

type Env = Record<string, string | undefined>

export type AgentZone = {
  /** Apex the agent hostnames hang off, e.g. "atlasdeploy.xyz". Lowercase, no dots at the ends. */
  domain: string
  /** Cloudflare zone id that holds the A records. Null when DNS automation is off for this zone. */
  zoneId: string | null
  /** Env vars that configure this zone, for messages; the cert + key are read lazily (see originCertFor). */
  vars: { domain: string; zoneId: string; cert: string; key: string }
}

export type OriginCert = { certPem: string; keyPem: string }

function clean(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "")
}

/** The zone every agent created so far lives in (`sovereignclaw.xyz` unless overridden). */
export function legacyAgentZone(env: Env = process.env): AgentZone {
  return {
    domain: normalizeDomain(clean(env.CLOUDFLARE_BASE_DOMAIN) ?? LEGACY_AGENT_DOMAIN),
    zoneId: clean(env.CLOUDFLARE_ZONE_ID),
    vars: {
      domain: "CLOUDFLARE_BASE_DOMAIN",
      zoneId: "CLOUDFLARE_ZONE_ID",
      cert: "CLOUDFLARE_ORIGIN_CERT_PEM",
      key: "CLOUDFLARE_ORIGIN_CERT_KEY",
    },
  }
}

/**
 * The zone new agents move to, or null when it is not configured. It takes
 * both the domain and the zone id; one without the other is ignored rather
 * than thrown on, because this sits on DNS cleanup paths that must keep
 * working through a half-finished config edit. `agentZoneConfigProblems`
 * reports it instead.
 */
export function newAgentZone(env: Env = process.env): AgentZone | null {
  const domain = clean(env.CLOUDFLARE_AGENT_DOMAIN)
  const zoneId = clean(env.CLOUDFLARE_AGENT_ZONE_ID)
  if (!domain || !zoneId) return null
  return {
    domain: normalizeDomain(domain),
    zoneId,
    vars: {
      domain: "CLOUDFLARE_AGENT_DOMAIN",
      zoneId: "CLOUDFLARE_AGENT_ZONE_ID",
      cert: "CLOUDFLARE_AGENT_ORIGIN_CERT_PEM",
      key: "CLOUDFLARE_AGENT_ORIGIN_CERT_KEY",
    },
  }
}

/** Where a NEW agent's hostname is created: the new zone once configured, else the legacy one. */
export function primaryAgentZone(env: Env = process.env): AgentZone {
  return newAgentZone(env) ?? legacyAgentZone(env)
}

/** Every zone an existing agent may live in, primary first, without duplicates. */
export function agentZones(env: Env = process.env): AgentZone[] {
  const zones = [newAgentZone(env), legacyAgentZone(env)].filter((z): z is AgentZone => z !== null)
  return zones.filter((z, i) => zones.findIndex((o) => o.domain === z.domain) === i)
}

/**
 * The configured zone a hostname belongs to, by suffix, or null when it belongs
 * to none (a custom domain, or a zone that has since been unconfigured).
 * Longest match wins, so a zone nested under another resolves to itself.
 */
export function zoneForHostname(hostname: string | null | undefined, env: Env = process.env): AgentZone | null {
  const host = hostname ? normalizeDomain(hostname) : ""
  if (!host) return null
  const matches = agentZones(env).filter((z) => host === z.domain || host.endsWith(`.${z.domain}`))
  matches.sort((a, b) => b.domain.length - a.domain.length)
  return matches[0] ?? null
}

/** Cloudflare DNS automation is usable for a zone when we have a token and its zone id. */
export function zoneDnsEnabled(
  zone: AgentZone | null,
  env: Env = process.env,
): zone is AgentZone & { zoneId: string } {
  return Boolean(zone?.zoneId && clean(env.CLOUDFLARE_API_TOKEN))
}

/** The DNS names a certificate covers (its subjectAltName entries). */
function certDnsNames(x509: X509Certificate): string[] {
  return (x509.subjectAltName ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("DNS:"))
    .map((s) => s.slice(4))
}

/** What a PEM certificate covers and until when, for the check script. Throws if it does not parse. */
export function describeCertificate(certPem: string): { names: string[]; notAfter: Date } {
  const x509 = new X509Certificate(certPem)
  return { names: certDnsNames(x509), notAfter: new Date(x509.validTo) }
}

/**
 * Why a cert + key cannot serve a zone's agents behind a Full (strict) edge,
 * or null when they can. A cert for another zone is exactly what a textual
 * find-and-replace of the domain in .env leaves behind, because the domain
 * inside a PEM is base64. Every one of these is a 526 (or a Caddy that refuses
 * to load the pair) on every agent in the zone, so it is caught here, once,
 * instead of on each box.
 */
function originCertProblem(zone: AgentZone, certPem: string, keyPem: string, env: Env, now: Date): string | null {
  const { cert: certVar, key: keyVar } = zone.vars
  let x509: X509Certificate
  try {
    x509 = new X509Certificate(certPem)
  } catch {
    return `${certVar} is not a readable X.509 certificate.`
  }
  // Agent hostnames are one label under the zone apex: <name>.<zone>.
  if (!x509.checkHost(`agent.${zone.domain}`)) {
    const names = certDnsNames(x509)
    return (
      `${certVar} is a certificate for ${names.length ? names.join(", ") : "other names"}, but agents get ` +
      `<name>.${zone.domain} (${zone.vars.domain}${clean(env[zone.vars.domain]) ? "" : " is unset, so that is the default"}): ` +
      `every one would be a 526 behind Full (strict). Fix whichever is wrong — the domain, or the certificate ` +
      `(a Cloudflare Origin CA certificate for *.${zone.domain} and ${zone.domain}, created in that zone).`
    )
  }
  let key: KeyObject
  try {
    key = createPrivateKey(keyPem)
  } catch {
    return `${keyVar} is not a readable private key (use the unencrypted PEM key Cloudflare shows once, when the certificate is created).`
  }
  if (!x509.checkPrivateKey(key)) {
    return `${keyVar} is not the private key of ${certVar}: Caddy would refuse to load the pair.`
  }
  const notAfter = new Date(x509.validTo)
  if (notAfter.getTime() <= now.getTime()) {
    return `${certVar} expired on ${notAfter.toISOString().slice(0, 10)}. Create a new Origin CA certificate for *.${zone.domain}.`
  }
  return null
}

/**
 * A zone's Origin CA cert + key, or null when none is configured.
 *
 * Throws on a half-configured or malformed pair, and on one that cannot serve
 * the zone (another zone's cert, a key from another cert, expired). Ignoring it
 * would put the wrong cert in front of a Full (strict) edge, which every
 * visitor sees as a 526 — failing the provision is the kinder outcome, and it
 * is what the provisioner always did for a bad CLOUDFLARE_ORIGIN_CERT_PEM.
 */
export function originCertFor(zone: AgentZone, env: Env = process.env, now: Date = new Date()): OriginCert | null {
  const { cert: certVar, key: keyVar } = zone.vars
  // Trimmed only to decide whether it is set; the PEM itself is used as given,
  // exactly as the provisioner always passed it through.
  const certRaw = clean(env[certVar]) ? env[certVar]! : null
  const keyRaw = clean(env[keyVar]) ? env[keyVar]! : null
  if (!certRaw && !keyRaw) return null
  if (!certRaw || !keyRaw) {
    throw new Error(
      `${certRaw ? keyVar : certVar} is not set but ${certRaw ? certVar : keyVar} is. Set both or neither.`,
    )
  }
  const certPem = normalizePem(certRaw)
  const keyPem = normalizePem(keyRaw)
  for (const [name, value] of [
    [certVar, certPem],
    [keyVar, keyPem],
  ] as const) {
    if (!isValidPem(value)) {
      throw new Error(
        `${name} is set but does not contain valid PEM data (missing -----BEGIN header). ` +
          "Check the env var encoding — multi-line PEM values need real newlines, not literal \\n strings.",
      )
    }
  }
  const problem = originCertProblem(zone, certPem, keyPem, env, now)
  if (problem) throw new Error(problem)
  return { certPem, keyPem }
}

/** Human-readable problems with the agent-zone configuration, for startup checks and the cutover runbook. */
export function agentZoneConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = []
  const domain = clean(env.CLOUDFLARE_AGENT_DOMAIN)
  const zoneId = clean(env.CLOUDFLARE_AGENT_ZONE_ID)
  if (Boolean(domain) !== Boolean(zoneId)) {
    problems.push(
      `${domain ? "CLOUDFLARE_AGENT_ZONE_ID" : "CLOUDFLARE_AGENT_DOMAIN"} is not set but ` +
        `${domain ? "CLOUDFLARE_AGENT_DOMAIN" : "CLOUDFLARE_AGENT_ZONE_ID"} is — new agents stay in ` +
        `${legacyAgentZone(env).domain} until both are set.`,
    )
  }
  for (const zone of agentZones(env)) {
    try {
      if (!originCertFor(zone, env)) {
        problems.push(
          `No origin certificate for ${zone.domain} (${zone.vars.cert} / ${zone.vars.key}): ` +
            `agents there are served with a self-signed cert, which only works while the zone's SSL mode is "Full", not "Full (strict)".`,
        )
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err))
    }
  }
  return problems
}
