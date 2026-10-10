/**
 * One-time Cloudflare zone bootstrap for the agent zone new agents are created
 * in — `CLOUDFLARE_AGENT_DOMAIN` once that is configured, otherwise the legacy
 * `sovereignclaw.xyz` (see src/lib/agent-zones.ts).
 *
 *   - Forces SSL=Full(Strict), Always-Use-HTTPS, Auto-HTTPS-Rewrites, min TLS 1.2
 *   - Adds a wildcard A record `*.<zone>` → CLOUDFLARE_FALLBACK_IP
 *     (proxied) so unknown subdomains don't leak origin errors.
 *
 * Run with:
 *   node --env-file=.env --import tsx scripts/cloudflare-bootstrap.ts
 *
 * Required env: CLOUDFLARE_API_TOKEN (with Zone Settings + DNS edit on the zone),
 *               the zone (CLOUDFLARE_AGENT_DOMAIN + CLOUDFLARE_AGENT_ZONE_ID, or
 *               the legacy CLOUDFLARE_ZONE_ID), and
 *               CLOUDFLARE_FALLBACK_IP (the "agent not found" landing IP)
 *
 * Full (strict) needs an Origin CA certificate on every agent box. Issue it in
 * the Cloudflare dashboard for THIS zone (SSL/TLS → Origin Server → Create
 * Certificate, Hostnames: *.<zone>, <zone>, 15-year validity) and put the raw
 * PEM (NOT base64) in CLOUDFLARE_AGENT_ORIGIN_CERT_PEM / _KEY for the agent
 * zone, or CLOUDFLARE_ORIGIN_CERT_PEM / _KEY for the legacy one — multi-line
 * inside double quotes, or single-line with `\n` escapes (normalizePem() turns
 * them back into newlines). The provisioner installs it over SSH on each box
 * when the agent is configured.
 */
import { patchZoneSetting, upsertDnsRecord } from "@/lib/cloudflare"
import { agentZoneConfigProblems, primaryAgentZone } from "@/lib/agent-zones"

async function main() {
  const fallbackIp = process.env.CLOUDFLARE_FALLBACK_IP
  if (!fallbackIp) {
    throw new Error(
      "CLOUDFLARE_FALLBACK_IP is not set (IP of the wildcard landing host)",
    )
  }
  const zone = primaryAgentZone()
  if (!zone.zoneId) {
    throw new Error(`No zone id for ${zone.domain} (CLOUDFLARE_AGENT_ZONE_ID / CLOUDFLARE_ZONE_ID).`)
  }
  for (const problem of agentZoneConfigProblems()) console.warn(`warning: ${problem}`)
  const ctx = { zoneId: zone.zoneId }

  console.log(`Patching zone settings for ${zone.domain}...`)
  await patchZoneSetting("ssl", "full_strict", ctx)
  await patchZoneSetting("always_use_https", "on", ctx)
  await patchZoneSetting("automatic_https_rewrites", "on", ctx)
  await patchZoneSetting("min_tls_version", "1.2", ctx)

  console.log(`Upserting wildcard fallback *.${zone.domain} → ${fallbackIp} (proxied)`)
  const rec = await upsertDnsRecord(
    {
      name: `*.${zone.domain}`,
      ip: fallbackIp,
      proxied: true,
    },
    ctx,
  )
  console.log("OK:", rec.id, rec.name, "→", rec.content)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
