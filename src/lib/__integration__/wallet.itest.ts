// Integration tests for the credit ledger against a REAL postgres database.
// The wallet's core guarantees — FOR UPDATE row locking, non-negative balance,
// use-it-or-lose-it plan-credit expiry — are DB behaviors that unit tests
// cannot reach. Contracts asserted here are transcribed from the doc comments
// in src/lib/wallet.ts; do not weaken them without updating that source.
//
// `./db-env` MUST be imported first — it redirects DATABASE_URL at the test DB
// before `@/db` is evaluated.
import "./db-env"

import { beforeEach, describe, expect, it } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import {
  getOrCreateWallet,
  depositToWallet,
  deductFromWallet,
  depositPlanCredits,
  expirePlanCreditsWithinTx,
  getWalletCredits,
} from "@/lib/wallet"
import { DEFAULT_MIN_CREDITS } from "@/lib/credit-pricing"
import { db, users, wallets, walletTransactions, eq, sql } from "@/db"

/** Seed a fresh user and return its id. `email` is the only NOT NULL column
 *  without a default; `id`/timestamps are defaulted by the schema. */
async function seedUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `${createId()}@itest.local` })
    .returning({ id: users.id })
  return row.id
}

async function walletRow(userId: string) {
  const w = await db.query.wallets.findFirst({ where: eq(wallets.userId, userId) })
  if (!w) throw new Error("wallet not found")
  return w
}

async function transactions(userId: string) {
  const w = await walletRow(userId)
  return db.select().from(walletTransactions).where(eq(walletTransactions.walletId, w.id))
}

describe("wallet (DB-backed)", () => {
  beforeEach(async () => {
    // Wallet → User and WalletTransaction → Wallet are ON DELETE CASCADE, so
    // deleting users clears the whole ledger for a clean slate.
    await db.execute(sql`DELETE FROM "User"`)
  })

  it("getOrCreateWallet is idempotent — two calls yield one wallet row", async () => {
    const userId = await seedUser()
    const first = await getOrCreateWallet(userId)
    const second = await getOrCreateWallet(userId)
    expect(second.id).toBe(first.id)

    const rows = await db.select().from(wallets).where(eq(wallets.userId, userId))
    expect(rows).toHaveLength(1)
    // Documented seed: new wallets start at 0 with the default minimum.
    expect(Math.round(first.balance)).toBe(0)
    expect(first.minimumBalance).toBe(DEFAULT_MIN_CREDITS)
  })

  it("depositToWallet credits the balance and writes a ledger row", async () => {
    const userId = await seedUser()
    const newBalance = await depositToWallet(userId, 500, "topup", "test deposit")
    expect(newBalance).toBe(500)
    expect(await getWalletCredits(userId)).toBe(500)

    const txns = await transactions(userId)
    expect(txns).toHaveLength(1)
    expect(txns[0].type).toBe("topup")
    expect(Math.round(txns[0].amount)).toBe(500)
    expect(Math.round(txns[0].balanceAfter)).toBe(500)
  })

  it("deductFromWallet with sufficient balance succeeds and reduces the balance", async () => {
    const userId = await seedUser()
    await depositToWallet(userId, 1000, "topup") // balance 1000, min 200
    // 1000 >= 300 + 200 (minimum buffer) → allowed.
    const result = await deductFromWallet(userId, 300, "api_usage")
    expect(result.ok).toBe(true)
    expect(result.shortfall).toBe(0)
    expect(result.credits).toBe(700)
    expect(await getWalletCredits(userId)).toBe(700)
  })

  it("deductFromWallet rejects when it would breach the minimum buffer, leaving the balance untouched", async () => {
    const userId = await seedUser()
    await depositToWallet(userId, 500, "topup") // balance 500, min 200
    // 500 < 400 + 200 → rejected. Documented shape: ok:false, credits =
    // current (unchanged) balance, shortfall = full requested amount.
    const result = await deductFromWallet(userId, 400, "api_usage")
    expect(result.ok).toBe(false)
    expect(result.shortfall).toBe(400)
    expect(result.credits).toBe(500)
    // Balance untouched and no ledger row written for the rejected deduction.
    expect(await getWalletCredits(userId)).toBe(500)
    expect(await transactions(userId)).toHaveLength(1) // only the deposit
  })

  it("settlement mode (allowBelowMinimum) charges down to zero and reports the shortfall", async () => {
    const userId = await seedUser()
    await depositToWallet(userId, 300, "topup") // balance 300
    // Charge = min(500, 300) = 300; shortfall = 200. Floors at zero (never
    // below), ignoring the minimum buffer. ok stays false because the full
    // amount was not charged.
    const result = await deductFromWallet(userId, 500, "api_usage", undefined, undefined, {
      allowBelowMinimum: true,
    })
    expect(result.ok).toBe(false)
    expect(result.shortfall).toBe(200)
    expect(result.credits).toBe(0)
    expect(await getWalletCredits(userId)).toBe(0)
    // Never negative — the documented floor / DB CHECK.
    expect(await getWalletCredits(userId)).toBeGreaterThanOrEqual(0)
  })

  it("plan-credit expiry sweeps the plan bucket but leaves persistent credits", async () => {
    const userId = await seedUser()
    const past = new Date(Date.now() - 60_000)
    await depositPlanCredits(userId, 400, past) // plan bucket 400, balance 400
    await depositToWallet(userId, 300, "topup") // persistent +300 → balance 700
    expect(await getWalletCredits(userId)).toBe(700)

    const expired = await db.transaction((tx) => expirePlanCreditsWithinTx(tx, userId))
    expect(expired).toBe(400)

    // Plan bucket gone, persistent top-up survives.
    expect(await getWalletCredits(userId)).toBe(300)
    const w = await walletRow(userId)
    expect(Math.round(w.planCredits)).toBe(0)
    expect(w.planCreditsExpireAt).toBeNull()

    // A plan_expiry ledger row records the removal.
    const txns = await transactions(userId)
    const expiry = txns.find((t) => t.type === "plan_expiry")
    expect(expiry).toBeDefined()
    expect(Math.round(expiry!.amount)).toBe(-400)
  })

  it("concurrent deductions cannot overspend: exactly one full success, balance never negative", async () => {
    const userId = await seedUser()
    await depositToWallet(userId, 1000, "topup") // balance 1000, min 200
    // Two parallel 500-credit deductions. The FOR UPDATE lock serializes them:
    // the first sees 1000 (1000 >= 500+200) and succeeds; the second sees 500
    // (500 < 500+200) and is rejected. They can never both pass.
    const [a, b] = await Promise.all([
      deductFromWallet(userId, 500, "api_usage"),
      deductFromWallet(userId, 500, "api_usage"),
    ])
    const successes = [a, b].filter((r) => r.ok)
    expect(successes).toHaveLength(1)

    const final = await getWalletCredits(userId)
    expect(final).toBe(500) // exactly one 500-credit charge landed
    expect(final).toBeGreaterThanOrEqual(0) // never negative
  })
})
