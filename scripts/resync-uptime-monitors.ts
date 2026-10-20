// Point every agent's Uptime Kuma monitor at what it should probe now: the
// agent's public root (`/`), where a 200 means up. Monitors made before probed
// the runtime's health path, which a chat-UI agent answers with 401, so they
// all read as down. New and changed agents are synced on their own
// (syncUptimeMonitor); this fixes the monitors that already exist.
//
// Usage:
//   node --env-file=.env --import tsx scripts/resync-uptime-monitors.ts           # dry run: list only
//   node --env-file=.env --import tsx scripts/resync-uptime-monitors.ts --apply
//
// DEFAULTS TO DRY RUN, which only reads the database.

import { db, instances, and, ne, isNotNull } from "@/db"
import { buildMonitorUrl, syncUptimeMonitor } from "@/lib/uptime-monitoring"

const APPLY = process.argv.includes("--apply")

async function main() {
  const rows = await db.query.instances.findMany({
    where: and(isNotNull(instances.kumaMonitorId), ne(instances.status, "deleted")),
  })
  console.log(`${rows.length} agent(s) with a monitor${APPLY ? "" : " (dry run; pass --apply to update)"}`)
  let failed = 0
  for (const row of rows) {
    const url = buildMonitorUrl(row)
    console.log(`  ${row.id}  ${row.name}  monitor #${row.kumaMonitorId}  → ${url ?? "(not reachable; skipped)"}`)
    if (!APPLY || !url) continue
    try {
      await syncUptimeMonitor(row.id)
    } catch (err) {
      failed++
      console.error(`    FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(APPLY ? `Done. ${failed} failed (see the agent's log for monitor errors).` : "Dry run only.")
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
