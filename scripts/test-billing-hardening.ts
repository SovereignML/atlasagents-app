// Tests for the billing hardening work (Phase 1 + 3 of the hardening plan).
//
// Covers, deterministically and without any OpenRouter network calls:
//   A. Bigint dual-write — `balanceCents` shadows `balance` on every write.
//   B. Settlement + un-fund — a clawback-style deduct floors balance at zero,
//      reports the shortfall, and drops `lifetimeFundedCredits` by the full
//      requested amount (the P1.3 cap-lowering mechanic).
//   C. Claim+charge idempotency — the P1.2 daily-billing pattern: claiming an
//      event and deducting in ONE transaction means a second run is a no-op,
//      never a double charge.
//
// Run: TEST_USER_ID=<id> npm run test:billing-hardening

import { db, wallets, processedEvents, eq, and } from "@/db"
import {
  depositToWallet,
  deductFromWallet,
  deductWithinTx,
  getOrCreateWallet,
} from "@/lib/wallet"
import { claimEventOn } from "@/lib/idempotency"

const USER_ID = process.env.TEST_USER_ID
if (!USER_ID) {
  console.error("Set TEST_USER_ID env var to an existing user id.")
  process.exit(1)
}
const userId: string = USER_ID

const fails: string[] = []
function check(cond: boolean, msg: string) {
  if (!cond) fails.push(msg)
}

async function reset(walletId: string, balance: number, funded: number, min = 200) {
  await db
    .update(wallets)
    .set({
      balance,
      lifetimeFundedCredits: funded,
      minimumBalance: min,
      balanceCents: Math.round(balance),
      minimumBalanceCents: Math.round(min),
    })
    .where(eq(wallets.id, walletId))
}

async function readWallet(walletId: string) {
  const [w] = await db
    .select({
      balance: wallets.balance,
      balanceCents: wallets.balanceCents,
      funded: wallets.lifetimeFundedCredits,
    })
    .from(wallets)
    .where(eq(wallets.id, walletId))
  return w
}

async function main() {
  const wallet = await getOrCreateWallet(userId)

  // ── A. Bigint dual-write on deposit ───────────────────────────────────
  await reset(wallet.id, 0, 0)
  await depositToWallet(userId, 500, "topup", "hardening-test deposit")
  {
    const w = await readWallet(wallet.id)
    check(Math.round(w.balance) === 500, `A: balance expected 500, got ${w.balance}`)
    check(Number(w.balanceCents) === 500, `A: balanceCents expected 500, got ${w.balanceCents}`)
    check(Math.round(w.funded) === 500, `A: funded expected 500, got ${w.funded}`)
  }

  // ── B. Settlement deduct + un-fund (clawback mechanic) ────────────────
  // Balance 300, funded 1000; claw back 1000. Balance floors at 0 (charged
  // 300, shortfall 700), funded drops by the FULL 1000 → 0, cents tracks.
  await reset(wallet.id, 300, 1000)
  {
    const r = await deductFromWallet(userId, 1000, "refund", undefined, "hardening-test clawback", {
      allowBelowMinimum: true,
      reduceLifetimeFunded: true,
    })
    check(r.ok === false, `B: expected ok=false, got ${r.ok}`)
    check(r.shortfall === 700, `B: expected shortfall=700, got ${r.shortfall}`)
    check(r.credits === 0, `B: expected balance=0, got ${r.credits}`)
    const w = await readWallet(wallet.id)
    check(Number(w.balanceCents) === 0, `B: balanceCents expected 0, got ${w.balanceCents}`)
    check(Math.round(w.funded) === 0, `B: funded expected 0, got ${w.funded}`)
  }

  // ── C. Claim+charge idempotency (daily-billing pattern) ───────────────
  await reset(wallet.id, 1000, 1000)
  const eventId = `hardening-test:${wallet.id}:${Date.now()}`
  const chargeOnce = () =>
    db.transaction(async (tx) => {
      const claimed = await claimEventOn(tx, "test_daily", eventId)
      if (!claimed) return "already" as const
      await deductWithinTx(tx, userId, 100, "daily_compute", undefined, "hardening-test daily")
      return "charged" as const
    })
  const first = await chargeOnce()
  const second = await chargeOnce()
  {
    const w = await readWallet(wallet.id)
    check(first === "charged", `C: first run expected charged, got ${first}`)
    check(second === "already", `C: second run expected already, got ${second}`)
    check(Math.round(w.balance) === 900, `C: balance expected 900 (charged once), got ${w.balance}`)
  }
  // Cleanup the test idempotency row.
  await db
    .delete(processedEvents)
    .where(and(eq(processedEvents.source, "test_daily"), eq(processedEvents.eventId, eventId)))

  // Leave the wallet in a clean, known state.
  await reset(wallet.id, 0, 0)

  if (fails.length === 0) {
    console.log("✅ PASS — dual-write, settlement/un-fund, and claim+charge idempotency all correct")
  } else {
    console.error("❌ FAIL:\n  " + fails.join("\n  "))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
