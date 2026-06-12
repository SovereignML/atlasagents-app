// Credit ledger backed by the `Wallet` / `WalletTransaction` tables.
//
// Even though the column is named `balance` (doublePrecision, legacy), the
// app treats it as an INTEGER credit count. 1 credit = $0.01 USD — see
// `src/lib/credit-pricing.ts` for the canonical conversion.
//
// All callers pass and receive whole-number credits. The float column is
// only kept to avoid a destructive schema migration.
//
// Two layers of API:
//   - `depositWithinTx` / `deductWithinTx` take an existing transaction handle
//     so a caller can commit a wallet mutation ATOMICALLY with its own
//     side-effects (e.g. usage-sync advancing its per-instance pointer, or
//     daily-billing claiming an idempotency key). This is the crash-safety
//     seam: the money move and the bookkeeping land together or not at all.
//   - `depositToWallet` / `deductFromWallet` are the standalone wrappers that
//     open a transaction for callers with no other writes to coordinate.

import { db, wallets, walletTransactions, eq, sql } from "@/db"
import { DEFAULT_MIN_CREDITS } from "@/lib/credit-pricing"

export type DeductResult =
  | { ok: true; credits: number; shortfall: number }
  | { ok: false; credits: number; shortfall: number }

export type WalletTransactionType =
  | "plan_deposit"
  | "topup"
  | "daily_compute"
  | "api_usage"
  | "admin_grant"
  | "refund"
  // Use-it-or-lose-it sweep: unused plan credits removed at period end.
  | "plan_expiry"
  // Prorated daily-compute returned when an agent is deleted mid-day.
  | "compute_refund"

/** A Drizzle transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type WalletTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Return the wallet for a user, creating one if it doesn't exist yet.
 */
export async function getOrCreateWallet(userId: string) {
  const existing = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
  })
  if (existing) return existing

  const [created] = await db
    .insert(wallets)
    .values({
      userId,
      minimumBalance: DEFAULT_MIN_CREDITS,
      // Bigint migration Commit 2 — seed both shadow columns at creation so
      // new wallets never need backfilling (1 credit = 1 cent).
      balanceCents: 0,
      minimumBalanceCents: DEFAULT_MIN_CREDITS,
      planCredits: 0,
      planCreditsCents: 0,
    })
    .onConflictDoNothing()
    .returning()

  if (created) return created

  // Race: another caller created it between our read and insert.
  const retry = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
  })
  if (!retry) throw new Error(`getOrCreateWallet: failed for user ${userId}`)
  return retry
}

// ---------------------------------------------------------------------------
// Transaction-scoped core
// ---------------------------------------------------------------------------

/**
 * Deposit credits, inside an existing transaction. Always succeeds (no minimum
 * check). Increments `balance` and (unless `opts.skipLifetimeFunded`) the
 * monotonic `lifetimeFundedCredits` counter, and appends a ledger row. Returns
 * the new credit balance.
 *
 * `opts.skipLifetimeFunded` is for credits that are returned rather than
 * purchased (e.g. a prorated `compute_refund` on delete): they top the balance
 * back up but were never "new funding", so the funded counter must not move.
 */
export async function depositWithinTx(
  tx: WalletTx,
  userId: string,
  credits: number,
  type: WalletTransactionType,
  description?: string,
  instanceId?: string,
  opts: { skipLifetimeFunded?: boolean } = {},
): Promise<number> {
  const amount = Math.round(credits)
  if (amount <= 0) {
    throw new Error(`depositToWallet requires a positive credit amount, got ${credits}`)
  }

  const wallet = await getOrCreateWalletTx(tx, userId)

  const [updated] = await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} + ${amount}`,
      // Bigint migration Commit 2 — dual-write. `balance` stays authoritative;
      // `balanceCents` shadows it (1 credit = 1 cent) so reads can flip to
      // bigint once a drift check (see billing-reconcile) confirms they track.
      // COALESCE backfills null rows from the float on their first write.
      balanceCents: sql`COALESCE(${wallets.balanceCents}, ROUND(${wallets.balance})::bigint) + ${amount}`,
      // Monotonic lifetime-funded counter. Every PURCHASED deposit is "funding"
      // (topup, plan_deposit, admin_grant, refund), so those accrue here; a
      // returned credit (compute_refund) passes skipLifetimeFunded.
      ...(opts.skipLifetimeFunded
        ? {}
        : { lifetimeFundedCredits: sql`${wallets.lifetimeFundedCredits} + ${amount}` }),
    })
    .where(eq(wallets.id, wallet.id))
    .returning({ balance: wallets.balance })

  if (!updated) throw new Error(`depositToWallet: wallet not found for user ${userId}`)

  await tx.insert(walletTransactions).values({
    walletId: wallet.id,
    amount,
    type,
    description: description ?? null,
    instanceId: instanceId ?? null,
    balanceAfter: updated.balance,
  })

  return Math.round(updated.balance)
}

/**
 * Remove a locked wallet's leftover plan bucket from the balance and append a
 * `plan_expiry` ledger row. Returns the credits expired (0 if the bucket was
 * already empty). Shared by the renewal path (expire-then-replace) and the
 * period-end sweep. Caller is responsible for `planCreditsExpireAt`.
 */
async function expireBucketWithinTx(
  tx: WalletTx,
  wallet: { id: string; planCredits: number },
  instanceId?: string,
): Promise<number> {
  const leftover = Math.round(wallet.planCredits ?? 0)
  if (leftover <= 0) return 0

  const [updated] = await tx
    .update(wallets)
    .set({
      balance: sql`GREATEST(0, ${wallets.balance} - ${leftover})`,
      balanceCents: sql`GREATEST(0, COALESCE(${wallets.balanceCents}, ROUND(${wallets.balance})::bigint) - ${leftover})`,
      planCredits: 0,
      planCreditsCents: 0,
    })
    .where(eq(wallets.id, wallet.id))
    .returning({ balance: wallets.balance })

  if (!updated) throw new Error(`expireBucketWithinTx: wallet ${wallet.id} not found`)

  await tx.insert(walletTransactions).values({
    walletId: wallet.id,
    amount: -leftover,
    type: "plan_expiry",
    description: "Expired unused plan credits",
    instanceId: instanceId ?? null,
    balanceAfter: updated.balance,
  })
  return leftover
}

/**
 * Deposit a monthly plan allotment as EXPIRING credits, inside an existing
 * transaction. Use-it-or-lose-it: any unspent plan credits from the prior
 * period are expired first (a `plan_expiry` ledger row), then the new allotment
 * is added and becomes the current bucket with the given expiry. Persistent
 * top-ups are untouched. Returns the new total balance.
 */
export async function depositPlanCreditsWithinTx(
  tx: WalletTx,
  userId: string,
  credits: number,
  expireAt: Date | null,
  description?: string,
  instanceId?: string,
): Promise<number> {
  const amount = Math.round(credits)
  if (amount <= 0) {
    throw new Error(`depositPlanCredits requires a positive credit amount, got ${credits}`)
  }

  const wallet = await getOrCreateWalletTx(tx, userId, { forUpdate: true })

  // 1. Expire last period's leftover plan credits (no-op if none).
  await expireBucketWithinTx(tx, wallet, instanceId)

  // 2. Add the new allotment and make it the current bucket. `lifetimeFunded`
  //    still accrues (reporting; no longer drives the OpenRouter cap).
  const [updated] = await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} + ${amount}`,
      balanceCents: sql`COALESCE(${wallets.balanceCents}, ROUND(${wallets.balance})::bigint) + ${amount}`,
      lifetimeFundedCredits: sql`${wallets.lifetimeFundedCredits} + ${amount}`,
      planCredits: amount,
      planCreditsCents: amount,
      planCreditsExpireAt: expireAt,
    })
    .where(eq(wallets.id, wallet.id))
    .returning({ balance: wallets.balance })

  if (!updated) throw new Error(`depositPlanCredits: wallet not found for user ${userId}`)

  await tx.insert(walletTransactions).values({
    walletId: wallet.id,
    amount,
    type: "plan_deposit",
    description: description ?? null,
    instanceId: instanceId ?? null,
    balanceAfter: updated.balance,
  })

  return Math.round(updated.balance)
}

/** Standalone wrapper for {@link depositPlanCreditsWithinTx}. */
export async function depositPlanCredits(
  userId: string,
  credits: number,
  expireAt: Date | null,
  description?: string,
  instanceId?: string,
): Promise<number> {
  return db.transaction((tx) =>
    depositPlanCreditsWithinTx(tx, userId, credits, expireAt, description, instanceId),
  )
}

/**
 * Expire a user's plan bucket NOW (period-end sweep for cancelled/lapsed subs
 * that get no renewal deposit). Locks the wallet, removes the unspent plan
 * credits, clears `planCreditsExpireAt`, and returns the credits expired.
 */
export async function expirePlanCreditsWithinTx(
  tx: WalletTx,
  userId: string,
): Promise<number> {
  const wallet = await getOrCreateWalletTx(tx, userId, { forUpdate: true })
  const expired = await expireBucketWithinTx(tx, wallet)
  if (wallet.planCreditsExpireAt) {
    await tx
      .update(wallets)
      .set({ planCreditsExpireAt: null })
      .where(eq(wallets.id, wallet.id))
  }
  return expired
}

/**
 * Deduct credits, inside an existing transaction. Locks the wallet row
 * (`SELECT … FOR UPDATE`) so concurrent deductions can't both pass the minimum
 * check on the same balance and overspend.
 *
 * `opts.allowBelowMinimum` switches to SETTLEMENT mode for already-incurred
 * cost (real OpenRouter usage, payment reversals): deduct as much as possible
 * down to — but never below — zero, ignoring the minimum-balance buffer. `ok`
 * is true only when the full amount was charged; otherwise `shortfall` carries
 * the uncharged remainder.
 *
 * `opts.reduceLifetimeFunded` (payment reversals only) decrements the monotonic
 * funded counter by the FULL requested amount (floored at zero), regardless of
 * how much could actually be clawed back. A refund un-funds the wallet, so the
 * OpenRouter spend cap (= funded × margin) must drop to match.
 */
export async function deductWithinTx(
  tx: WalletTx,
  userId: string,
  credits: number,
  type: WalletTransactionType,
  instanceId?: string,
  description?: string,
  opts: { allowBelowMinimum?: boolean; reduceLifetimeFunded?: boolean } = {},
): Promise<DeductResult> {
  const amount = Math.round(credits)
  if (amount <= 0) {
    throw new Error(`deductFromWallet requires a positive credit amount, got ${credits}`)
  }

  // Lock the wallet row for the duration of the transaction. Without
  // FOR UPDATE, two concurrent deductions under READ COMMITTED can both pass
  // the minimum check on the same balance and both update — a lost-update
  // race causing overspend.
  const wallet = await getOrCreateWalletTx(tx, userId, { forUpdate: true })

  // How much we can actually take.
  let charge: number
  if (opts.allowBelowMinimum) {
    // Settlement: charge what we can, down to zero. Never negative — the DB
    // CHECK forbids it and the invariant means it shouldn't be needed.
    charge = Math.min(amount, Math.round(wallet.balance))
  } else {
    if (wallet.balance < amount + wallet.minimumBalance) {
      return {
        ok: false as const,
        credits: Math.round(wallet.balance),
        shortfall: amount,
      }
    }
    charge = amount
  }
  const shortfall = amount - charge
  const reduceFunded = opts.reduceLifetimeFunded === true

  // One UPDATE covers both effects: the balance charge and (for reversals) the
  // funded-counter reduction. Skip it entirely only when there's nothing to do.
  if (charge > 0 || reduceFunded) {
    const [updated] = await tx
      .update(wallets)
      .set({
        ...(charge > 0
          ? {
              balance: sql`${wallets.balance} - ${charge}`,
              // Dual-write (see depositWithinTx). GREATEST(0, …) mirrors the
              // non-negative invariant the float column's CHECK enforces.
              balanceCents: sql`GREATEST(0, COALESCE(${wallets.balanceCents}, ROUND(${wallets.balance})::bigint) - ${charge})`,
              // Use-it-or-lose-it: drain the expiring plan bucket FIRST, so a
              // spend protects the user's persistent top-ups. GREATEST(0, …)
              // takes min(charge, planCredits) — once the plan bucket is empty
              // the rest comes out of persistent credits implicitly.
              planCredits: sql`GREATEST(0, ${wallets.planCredits} - ${charge})`,
              planCreditsCents: sql`GREATEST(0, COALESCE(${wallets.planCreditsCents}, ROUND(${wallets.planCredits})::bigint) - ${charge})`,
            }
          : {}),
        ...(reduceFunded
          ? {
              lifetimeFundedCredits: sql`GREATEST(0, ${wallets.lifetimeFundedCredits} - ${amount})`,
            }
          : {}),
      })
      .where(eq(wallets.id, wallet.id))
      .returning({ balance: wallets.balance })

    if (!updated) throw new Error(`deductFromWallet: wallet not found for user ${userId}`)

    // Only the balance change is a ledger event; a pure funded-counter drop
    // (clawback against an already-empty wallet) moves no credits.
    if (charge > 0) {
      await tx.insert(walletTransactions).values({
        walletId: wallet.id,
        amount: -charge,
        type,
        description: description ?? null,
        instanceId: instanceId ?? null,
        balanceAfter: updated.balance,
      })
    }

    return shortfall === 0
      ? { ok: true as const, credits: Math.round(updated.balance), shortfall: 0 }
      : { ok: false as const, credits: Math.round(updated.balance), shortfall }
  }

  return {
    ok: false as const,
    credits: Math.round(wallet.balance),
    shortfall,
  }
}

// ---------------------------------------------------------------------------
// Standalone wrappers (open their own transaction)
// ---------------------------------------------------------------------------

/**
 * Grant credits to a user's wallet. Always succeeds (no minimum check).
 * Returns the new credit balance.
 */
export async function depositToWallet(
  userId: string,
  credits: number,
  type: WalletTransactionType,
  description?: string,
  instanceId?: string,
  opts: { skipLifetimeFunded?: boolean } = {},
): Promise<number> {
  return db.transaction((tx) =>
    depositWithinTx(tx, userId, credits, type, description, instanceId, opts),
  )
}

/**
 * Deduct credits from a user's wallet. Returns `{ ok: false }` if the
 * balance would drop below the per-wallet minimum so callers can react
 * without catching exceptions. See `deductWithinTx` for `opts`.
 */
export async function deductFromWallet(
  userId: string,
  credits: number,
  type: WalletTransactionType,
  instanceId?: string,
  description?: string,
  opts: { allowBelowMinimum?: boolean; reduceLifetimeFunded?: boolean } = {},
): Promise<DeductResult> {
  return db.transaction((tx) =>
    deductWithinTx(tx, userId, credits, type, instanceId, description, opts),
  )
}

/** Read the current credit balance for a user. */
export async function getWalletCredits(userId: string): Promise<number> {
  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
    columns: { balance: true },
  })
  return Math.round(wallet?.balance ?? 0)
}

/** Backwards-compatible alias — returns integer credits, not USD. */
export const getWalletBalance = getWalletCredits

/**
 * Cumulative credits ever funded into the user's wallet, net of payment
 * reversals. Drives the OpenRouter per-key spend cap. Returns 0 if the user
 * has no wallet yet.
 */
export async function getLifetimeFundedCredits(userId: string): Promise<number> {
  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
    columns: { lifetimeFundedCredits: true },
  })
  return Math.round(wallet?.lifetimeFundedCredits ?? 0)
}

/** Check whether a user's wallet credit balance is at or above the minimum. */
export async function isAboveMinimum(userId: string): Promise<boolean> {
  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
    columns: { balance: true, minimumBalance: true },
  })
  if (!wallet) return false
  return wallet.balance >= wallet.minimumBalance
}

// ---------------------------------------------------------------------------
// Internal helper: get-or-create inside an existing transaction
// ---------------------------------------------------------------------------

async function getOrCreateWalletTx(
  tx: WalletTx,
  userId: string,
  opts: { forUpdate?: boolean } = {},
) {
  // Fast path (no lock) uses the relational query for ergonomics.
  if (!opts.forUpdate) {
    const existing = await tx.query.wallets.findFirst({
      where: eq(wallets.userId, userId),
    })
    if (existing) return existing
  } else {
    // Locked path: SELECT … FOR UPDATE is atomic with the lock acquisition,
    // closing the read-then-decide race in deductFromWallet.
    const [locked] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for("update")
      .limit(1)
    if (locked) return locked
  }

  // First-time path: create the row, then (if locking was requested)
  // re-select it FOR UPDATE so the caller gets a locked row.
  const [created] = await tx
    .insert(wallets)
    .values({
      userId,
      minimumBalance: DEFAULT_MIN_CREDITS,
      // Bigint migration Commit 2 — seed both shadow columns at creation so
      // new wallets never need backfilling (1 credit = 1 cent).
      balanceCents: 0,
      minimumBalanceCents: DEFAULT_MIN_CREDITS,
      planCredits: 0,
      planCreditsCents: 0,
    })
    .onConflictDoNothing()
    .returning()

  if (created && !opts.forUpdate) return created

  // Either the insert conflicted (concurrent creator) or we need a
  // locked handle on the freshly-created row.
  if (opts.forUpdate) {
    const [locked] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for("update")
      .limit(1)
    if (!locked) throw new Error(`getOrCreateWalletTx: failed for user ${userId}`)
    return locked
  }

  const retry = await tx.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
  })
  if (!retry) throw new Error(`getOrCreateWalletTx: failed for user ${userId}`)
  return retry
}
