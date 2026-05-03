/**
 * One-time Cloudflare zone bootstrap for sovereignclaw.xyz.
 *
 *   - Forces SSL=Full(Strict), Always-Use-HTTPS, Auto-HTTPS-Rewrites, min TLS 1.2
 *   - Adds a wildcard A record `*.sovereignclaw.xyz` → CLOUDFLARE_FALLBACK_IP
 *     (proxied) so unknown subdomains don't leak origin errors.
 *
 * Run with:
 *   node --env-file=.env --import tsx scripts/cloudflare-bootstrap.ts
 *
 * Required env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID,
 *               CLOUDFLARE_FALLBACK_IP (the "agent not found" landing IP)
 *
 * The Origin Cert + key are issued via Cloudflare dashboard (SSL/TLS → Origin
 * Server → Create Certificate, Hostnames: *.sovereignclaw.xyz, sovereignclaw.xyz,
 * 15-year validity). Base64-encode and put in CLOUDFLARE_ORIGIN_CERT_PEM /
 * CLOUDFLARE_ORIGIN_CERT_KEY in your secret store. The SSH bootstrap writes
 * them to /etc/caddy/cf/ on each VM during provisioning.
 */
import { patchZoneSetting, upsertDnsRecord } from "@/lib/cloudflare"

async function main() {
  const fallbackIp = process.env.CLOUDFLARE_FALLBACK_IP
  if (!fallbackIp) {
    throw new Error(
      "CLOUDFLARE_FALLBACK_IP is not set (IP of the wildcard landing host)",
    )
  }
  const base = process.env.CLOUDFLARE_BASE_DOMAIN ?? "sovereignclaw.xyz"

  console.log("Patching zone settings...")
  await patchZoneSetting("ssl", "full_strict")
  await patchZoneSetting("always_use_https", "on")
  await patchZoneSetting("automatic_https_rewrites", "on")
  await patchZoneSetting("min_tls_version", "1.2")

  console.log(`Upserting wildcard fallback *.${base} → ${fallbackIp} (proxied)`)
  const rec = await upsertDnsRecord({
    name: `*.${base}`,
    ip: fallbackIp,
    proxied: true,
  })
  console.log("OK:", rec.id, rec.name, "→", rec.content)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
