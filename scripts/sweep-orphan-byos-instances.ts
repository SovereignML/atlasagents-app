// One-off sweep: retire BYOS instance rows that were stranded by the old
// deploy-route ordering.
//
// Why this exists. src/app/api/byos/deploy/route.ts used to INSERT the instance
// row and only afterwards check whether Stripe was configured. In an
// environment without STRIPE_SECRET_KEY that check always failed, so every BYOS
// connection attempt returned 503 *and left a `pending` row behind*. Nothing
// ever cleaned those up: they have no subscription, no VM, no SSH fingerprint,
// and no provisioning ever ran against them.
//
// They are not harmless. countTeamAgents() (src/lib/seats.ts) counts every
// instance that isn't "deleted" against the team's agent cap, so a user who
// retried a BYOS connect a few times stopped seeing the 503 and started seeing
// "Agent limit reached" instead — locked out by their own failed attempts.
//
// The deploy route now gates on payment BEFORE the insert, so no new orphans
// are created. This closes out the ones already in the table.
//
// What counts as an orphan (all must hold):
//   - deploymentTarget = "byos"
//   - status = "pending"                  (never advanced to provisioning)
//   - no Subscription row                 (never paid for)
//   - ipAddress IS NULL                   (provisionByosBot sets this on its
//                                          first stage, so a null means we
//                                          never even tried to connect)
//   - sshHostFingerprint IS NULL          (never completed an SSH handshake)
//
// Deliberately conservative: anything that was paid for, or that we ever
// touched over SSH, is left alone for a human to look at.
//
// Usage:
//   node --env-file=.env --import tsx scripts/sweep-orphan-byos-instances.ts
//   node --env-file=.env --import tsx scripts/sweep-orphan-byos-instances.ts --apply
//
// Unlike the other backfills in this directory this one DEFAULTS TO DRY RUN and
// requires --apply, because it retires rows rather than creating them.

import { db, instances, subscriptions, eq, and, isNull } from "@/db"
import { transitionInstance } from "@/lib/instance-state"

const APPLY = process.argv.includes("--apply")

async function main() {
  const candidates = await db
    .select({
      id: instances.id,
      name: instances.name,
      teamId: instances.teamId,
      userId: instances.userId,
      byosHost: instances.byosHost,
      createdAt: instances.createdAt,
      subscriptionId: subscriptions.id,
    })
    .from(instances)
    .leftJoin(subscriptions, eq(subscriptions.instanceId, instances.id))
    .where(
      and(
        eq(instances.deploymentTarget, "byos"),
        eq(instances.status, "pending"),
        isNull(instances.ipAddress),
        isNull(instances.sshHostFingerprint),
      ),
    )

  const orphans = candidates.filter((row) => row.subscriptionId === null)
  const skipped = candidates.length - orphans.length

  if (orphans.length === 0) {
    console.log(
      `No orphan BYOS instances found${skipped > 0 ? ` (${skipped} pending row(s) have a subscription — left alone)` : ""}.`,
    )
    return
  }

  console.log(
    `${orphans.length} orphan BYOS instance(s)${APPLY ? "" : " (dry run — pass --apply to retire them)"}:`,
  )
  for (const row of orphans) {
    console.log(
      `  ${row.id}  ${row.name}  host=${row.byosHost ?? "-"}  team=${row.teamId}  created=${row.createdAt.toISOString()}`,
    )
  }
  if (skipped > 0) {
    console.log(`(${skipped} pending BYOS row(s) have a subscription — left alone.)`)
  }

  if (!APPLY) return

  let retired = 0
  for (const row of orphans) {
    try {
      // Go through the state machine rather than a raw UPDATE so deletedAt and
      // lastTransitionAt are stamped the same way a real delete would.
      await transitionInstance(row.id, ["pending"], "deleting")
      await transitionInstance(row.id, ["deleting"], "deleted", {
        error: "Retired: BYOS connect failed before payment; no server was ever contacted.",
      })
      retired++
    } catch (err) {
      console.error(`  ! ${row.id} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(`Retired ${retired}/${orphans.length}.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
