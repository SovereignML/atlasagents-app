// Tests the deterministic money mechanics behind margin-protected,
// real-usage OpenRouter billing — the parts that don't require live
// OpenRouter / SSH calls:
//
//   1. Margin math (credit-pricing): cap = funded × margin, charge = usage ÷ margin.
//   2. fundWallet accrues lifetimeFundedCredits and balance together.
//   3. computeKeyLimitUsd derives the cap from lifetime funding.
//   4. deductFromWallet settlement mode (allowBelowMinimum) charges into the
//      minimum buffer and reports shortfall correctly.
//
// The end-to-end poller (real getRuntimeKey usage → wallet charge →
// enforcement) is exercised manually per the plan's verification section,
// since it depends on live OpenRouter + the bot VM.
//
// Usage:
//   node --env-file=.env --import tsx scripts/test-openrouter-usage-sync.ts
//
// Creates and cleans up a throwaway user + wallet.

import { randomUUID } from "node:crypto"
import { db, users, wallets, eq, creditLedger, usageEvents, subscriptions, auditLogs } from "@/db"
import {
  OPENROUTER_MARGIN,
  keyLimitUsdFromCredits,
  openRouterUsdToCredits,
} from "@/lib/credit-pricing"
import { fundWallet, computeKeyLimitUsd } from "@/lib/openrouter-billing"
import { deductFromWallet, getLifetimeFundedCredits } from "@/lib/wallet"

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps
}

async function main() {
  const fail: string[] = []

  // ── 1. Margin math ──────────────────────────────────────────────────────
  if (OPENROUTER_MARGIN !== 0.9) {
    console.warn(
      `[test] OPENROUTER_MARGIN is ${OPENROUTER_MARGIN}, not 0.9 — adjusting expectations.`,
    )
  }
  const m = OPENROUTER_MARGIN
  // $5 (500 credits) funded → cap = $5 × margin.
  if (!approx(keyLimitUsdFromCredits(500), 5 * m)) {
    fail.push(`keyLimitUsdFromCredits(500) = ${keyLimitUsdFromCredits(500)}, want ${5 * m}`)
  }
  // Real usage of $5×margin marks back up to exactly 500 credits.
  if (openRouterUsdToCredits(5 * m) !== 500) {
    fail.push(`openRouterUsdToCredits(${5 * m}) = ${openRouterUsdToCredits(5 * m)}, want 500`)
  }
  // Sub-credit real usage rounds to 0 credits (accumulates across polls).
  if (openRouterUsdToCredits(0.000001) !== 0) {
    fail.push(`tiny usage should charge 0 credits, got ${openRouterUsdToCredits(0.000001)}`)
  }

  const email = `usage-sync-test-${randomUUID().slice(0, 8)}@example.test`
  const [user] = await db.insert(users).values({ email, name: "Usage Sync Test" }).returning()
  if (!user) throw new Error("failed to insert test user")

  try {
    // ── 2. fundWallet accrues balance + lifetime funding ──────────────────
    // No instances exist for this user, so syncOpenRouterLimitsForUser is a
    // no-op — fundWallet just deposits here.
    await fundWallet(user.id, 500, "topup", "test fund #1")
    let funded = await getLifetimeFundedCredits(user.id)
    if (funded !== 500) fail.push(`lifetimeFunded after 500 = ${funded}, want 500`)

    await fundWallet(user.id, 300, "topup", "test fund #2")
    funded = await getLifetimeFundedCredits(user.id)
    if (funded !== 800) fail.push(`lifetimeFunded after +300 = ${funded}, want 800`)

    // ── 3. computeKeyLimitUsd tracks lifetime funding (not balance) ───────
    const cap = await computeKeyLimitUsd(user.id)
    if (!approx(cap, 8 * m)) fail.push(`computeKeyLimitUsd = ${cap}, want ${8 * m}`)

    // ── 4. Settlement (allowBelowMinimum) ─────────────────────────────────
    // Wallet: balance 800, minimum 200 (default). A normal deduct of 700
    // would fail (800 < 700 + 200). Settlement charges it into the buffer.
    const normal = await deductFromWallet(user.id, 700, "api_usage", undefined, "normal")
    if (normal.ok) fail.push("normal deduct of 700 should fail (below minimum)")

    const settle = await deductFromWallet(
      user.id,
      700,
      "api_usage",
      undefined,
      "settlement",
      { allowBelowMinimum: true },
    )
    if (!settle.ok) fail.push(`settlement of 700 should fully charge, got shortfall ${settle.shortfall}`)
    if (settle.credits !== 100) fail.push(`balance after settle = ${settle.credits}, want 100`)

    // Now balance 100. Settle 250 more → charge only 100, shortfall 150, not ok.
    const partial = await deductFromWallet(
      user.id,
      250,
      "api_usage",
      undefined,
      "settlement-partial",
      { allowBelowMinimum: true },
    )
    if (partial.ok) fail.push("partial settlement should report ok:false")
    if (partial.shortfall !== 150) fail.push(`shortfall = ${partial.shortfall}, want 150`)
    if (partial.credits !== 0) fail.push(`balance after partial = ${partial.credits}, want 0`)

    // lifetimeFunded is untouched by spending.
    funded = await getLifetimeFundedCredits(user.id)
    if (funded !== 800) fail.push(`lifetimeFunded after spend = ${funded}, want 800 (unchanged)`)
  } finally {
    // Wallet, ledger, usage, subscription and audit rows RESTRICT deleting a
    // user (they are the money trail; accounts are closed, not deleted). This
    // throwaway fixture removes them first.
    await db.delete(creditLedger).where(eq(creditLedger.userId, user.id))
    await db.delete(usageEvents).where(eq(usageEvents.userId, user.id))
    await db.delete(subscriptions).where(eq(subscriptions.userId, user.id))
    await db.delete(auditLogs).where(eq(auditLogs.userId, user.id))
    await db.delete(wallets).where(eq(wallets.userId, user.id))
    await db.delete(users).where(eq(users.id, user.id))
  }

  if (fail.length === 0) {
    console.log("✅ PASS — margin math + lifetime funding + settlement all correct")
  } else {
    console.error("❌ FAIL:\n  " + fail.join("\n  "))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
