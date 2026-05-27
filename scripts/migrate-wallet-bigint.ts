// One-off backfill for the wallet bigint migration. Run AFTER db:push has
// added the new columns, BEFORE flipping reads in Commit 3.
//
// What it does:
//   1. Copy ROUND(balance) → balanceCents and ROUND(minimumBalance) →
//      minimumBalanceCents for every wallet where the cents column is NULL.
//   2. Assert the post-backfill row count matches the pre-backfill count
//      with both cents columns populated. Bail loudly on mismatch.
//
// Usage:
//   npm run wallets:bigint-backfill   # add this to package.json scripts
//
// Or directly:
//   node --env-file=.env --import tsx scripts/migrate-wallet-bigint.ts
//
// Safe to re-run — only fills NULL cents columns. Existing rows already
// migrated are skipped.

import { db, wallets, sql, isNull } from "@/db"

async function main() {
  const before = await db
    .select({
      total: sql<number>`count(*)::int`,
      populated: sql<number>`count(*) FILTER (WHERE "balanceCents" IS NOT NULL AND "minimumBalanceCents" IS NOT NULL)::int`,
    })
    .from(wallets)
  const [{ total, populated }] = before

  console.log(`[bigint-backfill] ${total} wallets total, ${populated} already populated`)

  if (total === populated) {
    console.log("[bigint-backfill] All wallets already populated. Nothing to do.")
    return
  }

  const result = await db
    .update(wallets)
    .set({
      balanceCents: sql`ROUND(${wallets.balance})::bigint`,
      minimumBalanceCents: sql`ROUND(${wallets.minimumBalance})::bigint`,
    })
    .where(isNull(wallets.balanceCents))
    .returning({ id: wallets.id })

  console.log(`[bigint-backfill] Backfilled ${result.length} wallets`)

  const after = await db
    .select({
      total: sql<number>`count(*)::int`,
      populated: sql<number>`count(*) FILTER (WHERE "balanceCents" IS NOT NULL AND "minimumBalanceCents" IS NOT NULL)::int`,
    })
    .from(wallets)
  const [{ total: t2, populated: p2 }] = after

  if (t2 !== p2) {
    console.error(
      `[bigint-backfill] FAILED: ${t2 - p2} wallets still have NULL cents columns. Investigate.`,
    )
    process.exit(1)
  }

  // Sanity: confirm no float ↔ cents drift on the freshly-backfilled rows.
  const drift = await db
    .select({
      id: wallets.id,
      balance: wallets.balance,
      balanceCents: wallets.balanceCents,
    })
    .from(wallets)
    .where(sql`ROUND(${wallets.balance})::bigint <> ${wallets.balanceCents}`)
    .limit(20)

  if (drift.length > 0) {
    console.error("[bigint-backfill] FAILED: drift detected on these wallets:", drift)
    process.exit(1)
  }

  console.log(`[bigint-backfill] OK: all ${t2} wallets populated and consistent.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
