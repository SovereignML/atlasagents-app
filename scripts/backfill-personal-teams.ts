// One-off backfill: give every existing User without a Team a personal team.
//
// Why this exists. Until now a Team was only created lazily, on the first
// /dashboard load (getUserTeam -> getOrCreatePersonalTeam). Registration itself
// created only the User row. Any account that signed up and never completed
// that first dashboard load — stopped at the verification mail, bounced at
// login, abandoned the flow — therefore had no Team.
//
// That made those accounts invisible to platform staff: /admin/teams, the
// /admin dashboard "Accounts" tab, and lib/admin-accounts.ts all build their
// result set starting FROM `Team` (inner-joined to the owner), so a user with
// no team produces no row anywhere. Signup now creates the team eagerly, in
// both /api/auth/register and the NextAuth `createUser` event (OAuth); this
// script closes the gap for accounts that registered before that change.
//
// Safe to re-run: getOrCreatePersonalTeam matches on teams.ownerId and returns
// the existing team rather than inserting a second one, and the query below
// only selects users who own no team at all. Users who merely *belong* to
// someone else's team (invited members) are intentionally included — owning a
// personal team is what makes them visible and is what the lazy path would
// have given them.
//
// Usage:
//   node --env-file=.env --import tsx scripts/backfill-personal-teams.ts
//   node --env-file=.env --import tsx scripts/backfill-personal-teams.ts --dry-run
//   node --env-file=.env --import tsx scripts/backfill-personal-teams.ts --audit
//
// --audit writes nothing. It reports users owning MORE than one team, which is
// how a duplicate-team bug would show up. Note that owning several teams is
// legitimate (MAX_TEAMS_PER_USER, the "Create New Team" flow), so a hit is a
// lead to inspect, not proof of a bug — look for same-day createdAt timestamps
// and near-identical auto-generated names ("X's Team"), which is the signature
// of the concurrent-create race rather than deliberate team creation.

import { db, users, teams, sql } from "@/db"
import { getOrCreatePersonalTeam } from "@/lib/team"

async function audit() {
  const dupes = await db
    .select({
      ownerId: teams.ownerId,
      email: users.email,
      teamCount: sql<number>`count(*)::int`,
      names: sql<string[]>`array_agg(${teams.name} ORDER BY ${teams.createdAt})`,
      createdAts: sql<string[]>`array_agg(${teams.createdAt}::text ORDER BY ${teams.createdAt})`,
    })
    .from(teams)
    .innerJoin(users, sql`${users.id} = ${teams.ownerId}`)
    .groupBy(teams.ownerId, users.email)
    .having(sql`count(*) > 1`)
    .orderBy(sql`count(*) DESC`)

  if (dupes.length === 0) {
    console.log("[audit] no user owns more than one team")
    return
  }

  console.log(`[audit] ${dupes.length} user(s) own more than one team:`)
  for (const d of dupes) {
    console.log(`[audit]   ${d.email} — ${d.teamCount} teams`)
    for (let i = 0; i < d.names.length; i++) {
      console.log(`[audit]       "${d.names[i]}"  ${d.createdAts[i]}`)
    }
  }
  console.log(
    "[audit] same-second timestamps + identical names => concurrent-create race;\n" +
      "[audit] spread-out timestamps + distinct names => deliberate, leave alone.",
  )
}

async function main() {
  if (process.argv.includes("--audit")) {
    await audit()
    return
  }

  const dryRun = process.argv.includes("--dry-run")

  // Users owning zero teams. NOT EXISTS rather than a left-join-is-null so the
  // planner can stop at the first matching team per user.
  const orphans = await db
    .select({ id: users.id, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(
      sql`NOT EXISTS (
        SELECT 1 FROM ${teams} WHERE ${teams.ownerId} = ${users.id}
      )`,
    )
    .orderBy(users.createdAt)

  console.log(`[backfill] ${orphans.length} user(s) own no team`)
  if (orphans.length === 0) return

  if (dryRun) {
    for (const u of orphans) {
      console.log(`[backfill]   would create team for ${u.email} (${u.createdAt.toISOString()})`)
    }
    console.log("[backfill] dry run — nothing written")
    return
  }

  let ok = 0
  let failed = 0
  for (const u of orphans) {
    try {
      const team = await getOrCreatePersonalTeam(u.id)
      ok++
      console.log(`[backfill] ${u.email} -> team ${team.id} (${team.name})`)
    } catch (err) {
      failed++
      // Keep going — one bad row must not strand the rest of the backfill.
      console.error(`[backfill] FAILED for ${u.email}:`, err)
    }
  }

  console.log(`[backfill] done — ${ok} created, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error("[backfill] fatal:", err)
    process.exit(1)
  })
  .finally(() => process.exit(process.exitCode ?? 0))
