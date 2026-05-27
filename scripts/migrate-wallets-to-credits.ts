/**
 * scripts/migrate-wallets-to-credits.ts
 *
 * One-shot migration: convert legacy USD-denominated `Wallet.balance`
 * values into integer CREDITS (1 credit = $0.01 USD).
 *
 * Heuristic: any wallet whose balance is a non-integer OR is below
 * 200 (the new minimum credit floor) is assumed to be USD and is
 * multiplied by 100. Wallets already in credits stay untouched.
 *
 * Usage:
 *   npx tsx scripts/migrate-wallets-to-credits.ts          # dry-run
 *   npx tsx scripts/migrate-wallets-to-credits.ts --apply  # write changes
 */
import "dotenv/config"
import { db, wallets, walletTransactions, eq, pool, sql } from "../src/db"

const APPLY = process.argv.includes("--apply")

const NEW_MIN_CREDITS = 200

async function main() {
  console.log(`[migrate] mode = ${APPLY ? "APPLY" : "dry-run"}`)

  const rows = await db.query.wallets.findMany()
  console.log(`[migrate] found ${rows.length} wallet(s)`)

  let migrated = 0
  let alreadyCredits = 0
  let skipped = 0

  for (const w of rows) {
    const looksLikeUsd =
      !Number.isInteger(w.balance) || (w.balance > 0 && w.balance < NEW_MIN_CREDITS)

    if (!looksLikeUsd) {
      alreadyCredits++
      continue
    }

    const newBalance = Math.round(w.balance * 100)
    const newMin = Math.max(NEW_MIN_CREDITS, Math.round(w.minimumBalance * 100))

    console.log(
      `[migrate] wallet ${w.id} (user ${w.userId}): balance ${w.balance} -> ${newBalance} credits, min ${w.minimumBalance} -> ${newMin}`,
    )

    if (!APPLY) {
      skipped++
      continue
    }

    await db.transaction(async (tx) => {
      await tx
        .update(wallets)
        .set({ balance: newBalance, minimumBalance: newMin })
        .where(eq(wallets.id, w.id))

      await tx.insert(walletTransactions).values({
        walletId: w.id,
        amount: newBalance - w.balance,
        type: "admin_grant",
        description: "Migration: USD -> credits (1 credit = $0.01)",
        balanceAfter: newBalance,
      })

      // Rewrite historical transaction amounts so the ledger keeps adding up.
      // amount and balanceAfter both stored as doublePrecision; multiply by 100.
      await tx.execute(sql`
        UPDATE "WalletTransaction"
        SET "amount" = "amount" * 100,
            "balanceAfter" = "balanceAfter" * 100
        WHERE "walletId" = ${w.id} AND "id" != (
          SELECT "id" FROM "WalletTransaction"
          WHERE "walletId" = ${w.id}
          ORDER BY "createdAt" DESC
          LIMIT 1
        )
      `)
    })

    migrated++
  }

  console.log(
    `[migrate] done. migrated=${migrated} alreadyCredits=${alreadyCredits} skipped=${skipped}`,
  )

  if (!APPLY) {
    console.log("[migrate] re-run with --apply to write changes.")
  }
}

main()
  .catch((e) => {
    console.error("[migrate] failed:", e)
    process.exit(1)
  })
  .finally(() => pool.end())
