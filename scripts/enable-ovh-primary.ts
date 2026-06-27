// One-off: make OVHcloud US the PRIMARY VPS provider on an EXISTING database.
//
// The static catalog in src/configs/providers.ts already marks OVH
// enabled + priority 120 and maps only the 3 VPS tiers (shared-4g/8g/16g), but
// the seed deliberately never re-clobbers a live row's `enabled`/`priority`
// (admin overrides win — see seed.ts), and it never removes stale plan rows. So
// on a DB seeded before this change the `ovh` row is still
// enabled=false / priority=80 and still carries the old Public Cloud plan
// mappings (d2-*/c2-* across every tier). This script reconciles the live DB to
// the catalog: flips the provider row, upserts the 3 VPS plans, and disables any
// other OVH plan rows.
//
// Idempotent — safe to re-run. Requires OVH_APP_KEY/SECRET/CONSUMER_KEY (endpoint
// ovh-us) + a default payment method on the OVH account for provisioning to
// actually succeed afterward (this script doesn't check those).
//
// Usage:
//   npm run providers:enable-ovh

import {
  db,
  providers,
  providerPlans,
  serverConfigs,
  eq,
  and,
  notInArray,
  pool,
} from "@/db"
import { PROVIDERS, PROVIDER_PLAN_MAP } from "@/configs/providers"

async function main() {
  const def = PROVIDERS.find((p) => p.slug === "ovh")
  if (!def) throw new Error("No `ovh` entry in src/configs/providers.ts PROVIDERS")

  // 1. Flip the provider row to primary (enabled + priority 120).
  const [row] = await db
    .update(providers)
    .set({ name: def.name, enabled: def.enabled, priority: def.defaultPriority })
    .where(eq(providers.slug, "ovh"))
    .returning({
      id: providers.id,
      name: providers.name,
      enabled: providers.enabled,
      priority: providers.priority,
    })

  if (!row) {
    console.error("No `ovh` provider row found — run `npm run db:seed` first.")
    process.exit(1)
  }

  // 2. Upsert the OVH VPS plans (shared-4g/8g/16g) from the catalog.
  const serverConfigRows = await db.query.serverConfigs.findMany({
    columns: { id: true, slug: true },
  })
  const serverConfigIdBySlug = new Map(serverConfigRows.map((r) => [r.slug, r.id]))

  const keptServerConfigIds: string[] = []
  let upserts = 0
  for (const mapping of PROVIDER_PLAN_MAP) {
    const ovh = mapping.codes.ovh
    if (!ovh) continue
    const serverConfigId = serverConfigIdBySlug.get(mapping.serverConfigSlug)
    if (!serverConfigId) {
      console.warn(`  skip ${mapping.serverConfigSlug} — no matching ServerConfig row`)
      continue
    }
    keptServerConfigIds.push(serverConfigId)
    await db
      .insert(providerPlans)
      .values({
        providerId: row.id,
        serverConfigId,
        providerPlanCode: ovh.code,
        monthlyCostUsd: ovh.monthlyCostUsd,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [providerPlans.providerId, providerPlans.serverConfigId],
        set: { providerPlanCode: ovh.code, monthlyCostUsd: ovh.monthlyCostUsd, enabled: true },
      })
    upserts++
  }

  // 3. Disable any other OVH plan rows (stale Public Cloud mappings) so the
  //    router only ever picks OVH for the 3 VPS tiers.
  const disabled = await db
    .update(providerPlans)
    .set({ enabled: false })
    .where(
      and(
        eq(providerPlans.providerId, row.id),
        keptServerConfigIds.length > 0
          ? notInArray(providerPlans.serverConfigId, keptServerConfigIds)
          : undefined,
      ),
    )
    .returning({ id: providerPlans.id })

  console.log(
    `OVHcloud is now the primary provider: ${row.name} (enabled=${row.enabled}, priority=${row.priority}). ` +
      `${upserts} VPS plan(s) upserted, ${disabled.length} stale OVH plan(s) disabled.`,
  )

  const missing = ["OVH_APP_KEY", "OVH_APP_SECRET", "OVH_CONSUMER_KEY"].filter(
    (v) => !process.env[v]?.trim(),
  )
  if (missing.length > 0) {
    console.warn(
      `WARNING: ${missing.join(", ")} not set in this environment — provisioning to OVH will fail until they are. ` +
        "Also ensure OVH_ENDPOINT=ovh-us and a default payment method is configured on the OVH account.",
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
