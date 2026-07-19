// One-off: run a warm-pool refill with fresh env (reaps stale-key VMs, creates
// the deficit for the currently-configured targets). Temporary helper.
import { refillWarmPool, getPoolTargets, poolKeyFor } from "@/lib/warm-pool"

async function main() {
  if (process.env.POOL_VERBOSE === "1") {
    console.log("Active pool targets:")
    for (const t of getPoolTargets()) console.log(`  ${t.size}x  ${poolKeyFor(t)}`)
  }
  const report = await refillWarmPool()
  console.log(`POOLREPORT ${JSON.stringify(report)}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
