// One-off backfill: register a Cloudflare for SaaS custom hostname for every
// white-label team that already has a custom domain, persisting the returned id
// into teamBranding.cfCustomHostnameId.
//
// MUST run BEFORE retiring the old Caddy on-demand-TLS catch-all — otherwise
// live tenant domains lose TLS the moment Caddy stops issuing their certs.
//
// Safe to re-run: rows that already have a cfCustomHostnameId are skipped, and
// an existing Cloudflare custom hostname for the domain is reused rather than
// duplicated.
//
// Usage:
//   node --env-file=.env --import tsx scripts/backfill-custom-hostnames.ts
//
// Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_SAAS_ZONE_ID (or CLOUDFLARE_ZONE_ID).

import { db, teamBranding, eq, and, isNull, isNotNull } from "@/db"
import {
  cfSaasConfigured,
  createCustomHostname,
  findCustomHostnameByName,
} from "@/lib/cloudflare-saas"

async function main() {
  if (!cfSaasConfigured()) {
    console.error(
      "[backfill] Cloudflare for SaaS is not configured " +
        "(need CLOUDFLARE_API_TOKEN + CLOUDFLARE_SAAS_ZONE_ID/CLOUDFLARE_ZONE_ID).",
    )
    process.exit(1)
  }

  const rows = await db.query.teamBranding.findMany({
    where: and(isNotNull(teamBranding.customDomain), isNull(teamBranding.cfCustomHostnameId)),
    columns: { teamId: true, customDomain: true },
  })

  console.log(`[backfill] ${rows.length} domain(s) to register`)
  let ok = 0
  let failed = 0

  for (const row of rows) {
    const domain = row.customDomain as string
    try {
      const ch =
        (await findCustomHostnameByName(domain).catch(() => null)) ??
        (await createCustomHostname(domain))
      await db
        .update(teamBranding)
        .set({ cfCustomHostnameId: ch.id, updatedAt: new Date() })
        .where(eq(teamBranding.teamId, row.teamId))
      ok++
      console.log(`  ✓ ${domain} → ${ch.id} (${ch.status}/${ch.ssl?.status ?? "?"})`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${domain}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`[backfill] done: ${ok} registered, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
