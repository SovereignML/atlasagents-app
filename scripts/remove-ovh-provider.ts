// One-off: remove the OVHcloud VPS provider from an EXISTING database.
//
// OVH has been dropped from the multi-provider router (adapter, config, tests).
// But the seed deliberately never re-clobbers a live row's `enabled`/`priority`
// (admin overrides win — see seed.ts), and it never deletes rows for providers
// that left the catalog. So on a DB seeded while OVH existed, the `ovh` Provider
// row (plus its plan/region/billing/health rows) persists — this script removes
// it and lets the FK cascades clean up the dependents:
//   • cascade  → ProviderPlan, ProviderRegion, ProviderBilling, ProviderHealthLog
//   • set null → RoutingLog.chosenProviderId
//
// Guard: if any `instances` row still points at OVH (a live/half-provisioned VM),
// the script ABORTS rather than orphaning FKs. OVH almost certainly never
// provisioned (no working credentials), but never assume.
//
// Idempotent — safe to re-run (no-op once the row is gone).
//
// Usage:
//   npm run providers:remove-ovh

import { db, providers, instances, eq, pool } from "@/db"

async function main() {
  const ovh = await db.query.providers.findFirst({
    where: eq(providers.slug, "ovh"),
    columns: { id: true, name: true },
  })

  if (!ovh) {
    console.log("No `ovh` provider row found — nothing to do.")
    return
  }

  // Guard: never delete a provider that still owns instances.
  const ownedInstances = await db.query.instances.findMany({
    where: eq(instances.providerId, ovh.id),
    columns: { id: true },
  })
  if (ownedInstances.length > 0) {
    console.error(
      `ABORTED: ${ownedInstances.length} instance(s) still reference the OVH provider ` +
        `(${ovh.id}). Migrate or delete them first:\n` +
        ownedInstances.map((i) => `  • ${i.id}`).join("\n"),
    )
    process.exit(1)
  }

  await db.delete(providers).where(eq(providers.id, ovh.id))

  console.log(
    `Removed OVH provider "${ovh.name}" (${ovh.id}). ` +
      "Plan/region/billing/health rows cascaded; routing-log references nulled.",
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
