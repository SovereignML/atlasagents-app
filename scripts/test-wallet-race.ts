// Stress test for the wallet FOR UPDATE lock added in src/lib/wallet.ts.
//
// Pre-fix: 10 concurrent deductions of 100 against a 500-credit wallet
// (minimum=200) would overspend — multiple would pass the
// `balance >= amount + minimumBalance` check on the same snapshot.
//
// Post-fix: deductions serialize; only the ones that fit before balance
// dips below minimum return ok:true. The final balance ≥ minimum.

import { db, wallets, eq } from "@/db"
import { deductFromWallet, depositToWallet, getOrCreateWallet } from "@/lib/wallet"

const USER_ID = process.env.TEST_USER_ID
if (!USER_ID) {
  console.error("Set TEST_USER_ID env var to an existing user id.")
  process.exit(1)
}
const userId: string = USER_ID

async function main() {
  const wallet = await getOrCreateWallet(userId)
  // Reset to a known starting state: 1000 credits, min 200.
  await db
    .update(wallets)
    .set({ balance: 1000, minimumBalance: 200 })
    .where(eq(wallets.id, wallet.id))

  console.log("Starting balance: 1000, minimum: 200")
  console.log("Firing 15 concurrent deductions of 100 each...")

  const results = await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      deductFromWallet(USER_ID!, 100, "api_usage", undefined, `race-test-${i}`)
        .then((r) => ({ i, ...r }))
        .catch((err) => ({ i, ok: false as const, credits: -1, error: String(err) })),
    ),
  )

  const ok = results.filter((r) => r.ok).length
  const denied = results.filter((r) => !r.ok).length

  const [final] = await db
    .select({ balance: wallets.balance, minimumBalance: wallets.minimumBalance })
    .from(wallets)
    .where(eq(wallets.id, wallet.id))

  console.log(`ok=${ok} denied=${denied}`)
  console.log(`final balance: ${final.balance}, minimum: ${final.minimumBalance}`)

  // Expectations:
  //   ok = 8 (1000 → 200 = 800 / 100 = 8 successful deductions)
  //   denied = 7 (must NOT exceed the floor)
  //   final balance = 200 (≥ minimum)
  const fail: string[] = []
  if (ok !== 8) fail.push(`expected ok=8, got ${ok}`)
  if (denied !== 7) fail.push(`expected denied=7, got ${denied}`)
  if (final.balance !== 200) fail.push(`expected final=200, got ${final.balance}`)
  if (final.balance < final.minimumBalance) {
    fail.push(`final ${final.balance} below minimum ${final.minimumBalance} — RACE NOT FIXED`)
  }

  if (fail.length === 0) {
    console.log("✅ PASS — lock serialized concurrent deductions correctly")
  } else {
    console.error("❌ FAIL:", fail.join("; "))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
