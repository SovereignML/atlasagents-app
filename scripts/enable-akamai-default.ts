// One-off: make Akamai (the `linode` provider adapter) the default VPS provider
// on an EXISTING database.
//
// The static catalog in src/configs/providers.ts already marks Akamai
// enabled + priority 110, but the seed deliberately never re-clobbers a live
// row's `enabled`/`priority` (admin overrides win — see seed.ts). So on a DB
// that was seeded before this change, the `linode` row is still
// enabled=false / priority=20. This script flips it to match the catalog.
//
// Idempotent — safe to re-run. Requires LINODE_API_TOKEN in the environment for
// provisioning to actually succeed afterward (this script doesn't check it).
//
// Usage:
//   npm run providers:enable-akamai

import { db, providers, eq, pool } from "@/db"

async function main() {
  const [row] = await db
    .update(providers)
    .set({ name: "Akamai", enabled: true, priority: 110 })
    .where(eq(providers.slug, "linode"))
    .returning({ id: providers.id, name: providers.name, enabled: providers.enabled, priority: providers.priority })

  if (!row) {
    console.error("No `linode` provider row found — run `npm run db:seed` first.")
    process.exit(1)
  }

  console.log(
    `Akamai is now the default provider: ${row.name} (enabled=${row.enabled}, priority=${row.priority}).`,
  )
  if (!process.env.LINODE_API_TOKEN) {
    console.warn(
      "WARNING: LINODE_API_TOKEN is not set in this environment — provisioning to Akamai will fail until it is.",
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
