// Read-only check of the agent-zone configuration in .env: which zone new
// agents will be created in, which zones existing agents are served from,
// whether each zone's origin cert actually covers it, and anything
// half-configured. Prints domains, zone ids and the names on each cert —
// never the cert, the key or the token.
//
// Usage:
//   node --env-file=.env --import tsx scripts/check-agent-zones.ts          # offline
//   node --env-file=.env --import tsx scripts/check-agent-zones.ts --live   # + Cloudflare API, GET only
//   node --env-file=.env --import tsx scripts/check-agent-zones.ts --live --strict
//
// --live also asks Cloudflare whether each zone id is the zone its domain says
// (a find-and-replace of the domain in .env never changes the id), whether the
// token can reach that zone's DNS, which SSL mode the zone is in, and whether
// agents still live in sovereignclaw.xyz after the variables stopped naming it.
// --strict also treats SSL mode "Full" as a problem: it works, but the edge
// doesn't verify the origin certificate, and Full (strict) is the target.
//
// Exits 1 when something needs fixing, so it can gate a deploy.

import {
  LEGACY_AGENT_DOMAIN,
  agentZoneConfigProblems,
  agentZones,
  describeCertificate,
  legacyAgentZone,
  originCertFor,
  primaryAgentZone,
  type AgentZone,
} from "@/lib/agent-zones"

const LIVE = process.argv.includes("--live")
const STRICT = process.argv.includes("--strict")

function certLine(zone: AgentZone): string {
  try {
    const cert = originCertFor(zone)
    if (!cert) return "NO origin cert"
    const { names, notAfter } = describeCertificate(cert.certPem)
    return `origin cert for ${names.join(", ")}, valid until ${notAfter.toISOString().slice(0, 10)}`
  } catch {
    return "origin cert UNUSABLE (see problems)"
  }
}

type CfGet<T> =
  | { ok: true; result: T; total: number | undefined }
  | { ok: false; status: number; message: string }

async function cfGet<T>(path: string): Promise<CfGet<T>> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN?.trim() ?? ""}` },
  })
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean
    result?: T
    result_info?: { total_count?: number }
    errors?: { message?: string }[]
  }
  if (res.ok && body.success !== false) {
    return { ok: true, result: body.result as T, total: body.result_info?.total_count }
  }
  const message = (body.errors ?? []).map((e) => e.message).filter(Boolean).join("; ") || res.statusText
  // Cloudflare's wording for "SSL for SaaS is not enabled here" is a sales pitch; say what it means.
  if (/No quota has been allocated/i.test(message)) {
    return { ok: false, status: res.status, message: "Cloudflare for SaaS is not enabled on this zone" }
  }
  return { ok: false, status: res.status, message }
}

/** GET-only checks of one zone against the Cloudflare API. */
async function liveZoneProblems(zone: AgentZone): Promise<string[]> {
  if (!zone.zoneId) return []
  const problems: string[] = []
  console.log(`  ${zone.domain}`)

  const info = await cfGet<{ name: string; status: string }>(`/zones/${zone.zoneId}`)
  if (info.ok) {
    console.log(`    zone id belongs to ${info.result.name} (${info.result.status})`)
    if (info.result.name.toLowerCase() !== zone.domain) {
      problems.push(
        `${zone.vars.zoneId} is the zone id of ${info.result.name}, but agents get <name>.${zone.domain} (${zone.vars.domain}): ` +
          `their DNS records would land in the wrong zone. Fix whichever is wrong — the domain, or the zone id ` +
          `(Cloudflare → the zone → Overview → Zone ID).`,
      )
    } else if (info.result.status !== "active") {
      problems.push(`${zone.domain} is "${info.result.status}" on Cloudflare, not "active": its hostnames do not resolve yet.`)
    }
  } else {
    console.log(`    zone details not readable (${info.status} ${info.message}); the token may just lack Zone:Read`)
  }

  const dns = await cfGet<unknown[]>(`/zones/${zone.zoneId}/dns_records?per_page=1`)
  if (dns.ok) {
    console.log("    token can read DNS records")
  } else {
    problems.push(
      `The API token cannot read DNS in ${zone.domain} (${dns.status} ${dns.message}): ` +
        `it needs DNS:Edit on that zone, or no agent there gets a hostname.`,
    )
  }

  const ssl = await cfGet<{ value: string }>(`/zones/${zone.zoneId}/settings/ssl`)
  if (!ssl.ok) {
    console.log(`    SSL mode not readable (${ssl.status} ${ssl.message})`)
  } else {
    const mode = ssl.result.value
    const label: Record<string, string> = { strict: "Full (strict)", full: "Full", flexible: "Flexible", off: "Off" }
    console.log(`    SSL mode: ${label[mode] ?? mode}`)
    if (mode === "flexible" || mode === "off") {
      problems.push(
        `${zone.domain} is in SSL mode "${label[mode]}". Caddy on every agent redirects HTTP to HTTPS, so Flexible is a ` +
          `redirect loop, and Off serves no HTTPS at all. Set Full (strict) (scripts/cloudflare-bootstrap.ts does it).`,
      )
    } else if (mode === "full") {
      if (STRICT) {
        problems.push(
          `${zone.domain} is in SSL mode "Full": the edge does not verify the origin certificate. Set Full (strict).`,
        )
      } else {
        console.log("    (works, but the edge does not verify the origin cert — Full (strict) is the target)")
      }
    }
  }
  return problems
}

/**
 * Agents created before a zone move keep their sovereignclaw.xyz hostnames.
 * If the legacy variables were repointed instead of the new zone going into
 * CLOUDFLARE_AGENT_*, nothing names that zone any more: those agents keep
 * serving, but their DNS records cannot be deleted and their certs not
 * reinstalled. Count what is left there.
 */
async function liveOrphanedLegacyZone(): Promise<string[]> {
  if (agentZones().some((z) => z.domain === LEGACY_AGENT_DOMAIN)) return []
  const zones = await cfGet<{ id: string; name: string }[]>(`/zones?name=${LEGACY_AGENT_DOMAIN}`)
  if (!zones.ok || !zones.result?.[0]) {
    console.log(`  ${LEGACY_AGENT_DOMAIN}: not reachable with this token, so leftover agents there cannot be counted`)
    return []
  }
  const records = await cfGet<unknown[]>(`/zones/${zones.result[0].id}/dns_records?type=A&per_page=1`)
  const count = records.ok ? (records.total ?? records.result.length) : null
  console.log(`  ${LEGACY_AGENT_DOMAIN}: no longer configured; ${count ?? "unknown number of"} A records left in it`)
  if (!count) return []
  return [
    `${count} A records (agent hostnames) still live in ${LEGACY_AGENT_DOMAIN}, which no CLOUDFLARE_* variable names any more. ` +
      `Those agents keep serving, but deleting one leaves its DNS record pointing at a released IP, and their origin certs cannot be reinstalled. ` +
      `To keep managing them, put ${LEGACY_AGENT_DOMAIN} back in CLOUDFLARE_BASE_DOMAIN / CLOUDFLARE_ZONE_ID / CLOUDFLARE_ORIGIN_CERT_* ` +
      `and the new zone in CLOUDFLARE_AGENT_* (docs/REBRAND-LEGACY-IDENTIFIERS.md).`,
  ]
}

async function main(): Promise<number> {
  const primary = primaryAgentZone()
  console.log(`New agents are created in:  ${primary.domain}  (zone ${primary.zoneId ?? "NOT SET"})`)
  console.log("Zones agents are served from:")
  for (const zone of agentZones()) {
    console.log(`  ${zone.domain.padEnd(24)} zone ${zone.zoneId ?? "NOT SET"}  ${certLine(zone)}  (${zone.vars.cert})`)
  }
  const saasZone = process.env.CLOUDFLARE_SAAS_ZONE_ID?.trim()
  console.log(
    `White-label custom hostnames: ${
      saasZone
        ? `zone ${saasZone} (CLOUDFLARE_SAAS_ZONE_ID)`
        : `zone ${legacyAgentZone().zoneId ?? "NOT SET"} (no CLOUDFLARE_SAAS_ZONE_ID, so CLOUDFLARE_ZONE_ID: ${legacyAgentZone().domain})`
    }`,
  )
  console.log(`CLOUDFLARE_API_TOKEN: ${process.env.CLOUDFLARE_API_TOKEN?.trim() ? "set" : "NOT SET"}`)

  const problems = agentZoneConfigProblems()
  if (LIVE) {
    if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
      problems.push("--live needs CLOUDFLARE_API_TOKEN.")
    } else {
      console.log("\nCloudflare (read-only):")
      for (const zone of agentZones()) problems.push(...(await liveZoneProblems(zone)))
      problems.push(...(await liveOrphanedLegacyZone()))
      const saasId = saasZone || legacyAgentZone().zoneId
      if (saasId) {
        const saas = await cfGet<{ name: string }>(`/zones/${saasId}`)
        const hosts = await cfGet<unknown[]>(`/zones/${saasId}/custom_hostnames?per_page=1`)
        console.log(
          `  white-label custom hostnames are registered in ${saas.ok ? saas.result.name : `zone ${saasId}`}: ` +
            (hosts.ok ? `${hosts.total ?? hosts.result.length} registered` : `count not readable (${hosts.status} ${hosts.message})`),
        )
      }
    }
  }

  if (problems.length === 0) {
    console.log("\nOK — no problems found.")
    return 0
  }
  console.log("\nProblems:")
  for (const p of problems) console.log(`  - ${p}`)
  return 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
