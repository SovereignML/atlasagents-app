// Billing façade — the single public surface for moving credits.
//
// All credit mutation flows through three verbs, so the coupling between a
// balance change and its side-effects lives in ONE place and can't drift:
//
//   - fund        deposit + raise/re-enable the OpenRouter spend caps
//   - charge      deduct (normal or settlement), via deductFromWallet
//   - clawBack    deduct + un-fund + LOWER the OpenRouter spend caps
//
// New code should import from `@/lib/billing`. The underlying modules
// (`wallet`, `openrouter-billing`, `credit-pricing`, …) remain the
// implementation; this barrel just gives them one well-documented entrypoint
// and hosts the cross-cutting flows (clawBack) that span two of them.

import { deductFromWallet, type DeductResult } from "@/lib/wallet"
import { fundWallet, syncOpenRouterLimitsForUser } from "@/lib/openrouter-billing"
import { usdToCredits } from "@/lib/credit-pricing"

// ── Re-exported surface ────────────────────────────────────────────────────

export {
  getOrCreateWallet,
  getWalletCredits,
  getWalletBalance,
  getLifetimeFundedCredits,
  isAboveMinimum,
  depositToWallet,
  deductFromWallet,
  depositWithinTx,
  deductWithinTx,
  type DeductResult,
  type WalletTransactionType,
  type WalletTx,
} from "@/lib/wallet"

export {
  fundWallet,
  syncOpenRouterLimitsForUser,
  computeKeyLimitUsd,
} from "@/lib/openrouter-billing"

export {
  CREDITS_PER_USD,
  DEFAULT_MIN_CREDITS,
  MIN_TOPUP_CREDITS,
  OPENROUTER_MARGIN,
  usdToCredits,
  creditsToUsd,
  keyLimitUsdFromCredits,
  openRouterUsdToCredits,
  formatCredits,
  formatCreditsAsUsd,
} from "@/lib/credit-pricing"

// ── Cross-cutting flow: payment-reversal clawback ───────────────────────────

/**
 * Reverse funds after a payment reversal (refund / lost dispute / voided paid
 * invoice). Settlement-mode deduction down to zero, and `reduceLifetimeFunded`
 * un-funds the wallet so the OpenRouter spend cap (= funded × margin) drops —
 * then re-sync the caps so the user's keys are PATCHed to the lower limit right
 * away (best-effort; the reconciler heals it if the PATCH fails). Returns the
 * deduct result so the caller can surface any uncovered shortfall.
 *
 * This is the dual of `fundWallet`: both keep the wallet and the OpenRouter
 * caps in lockstep, in one place.
 */
export async function clawBackFunds(
  userId: string,
  usd: number,
  reason: string,
): Promise<DeductResult & { creditsRequested: number }> {
  const creditsRequested = usdToCredits(usd)
  if (creditsRequested <= 0) {
    return { ok: true, credits: 0, shortfall: 0, creditsRequested: 0 }
  }
  const result = await deductFromWallet(userId, creditsRequested, "refund", undefined, reason, {
    allowBelowMinimum: true,
    reduceLifetimeFunded: true,
  })
  try {
    await syncOpenRouterLimitsForUser(userId)
  } catch (err) {
    console.warn(
      `[billing] clawback cap re-sync failed for user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return { ...result, creditsRequested }
}

// ── Cross-cutting flow: manual admin adjustment ─────────────────────────────

export type AdminAdjustResult = {
  /** New credit balance after the adjustment. */
  balance: number
  /** Credits actually applied (signed: + granted, − removed). */
  applied: number
  /** For a removal that couldn't fully complete, the uncovered remainder. */
  shortfall: number
}

/**
 * Apply a signed manual credit adjustment as an admin. Positive grants (via
 * `fundWallet`: deposit + raise caps); negative removes (settlement deduction +
 * un-fund + lower caps), so a correction can't leave the OpenRouter cap
 * stranded above the new funding. Logged to the ledger as `admin_grant`.
 */
export async function adminAdjustCredits(
  userId: string,
  credits: number,
  reason: string,
): Promise<AdminAdjustResult> {
  const amount = Math.round(credits)
  if (amount === 0) throw new Error("adminAdjustCredits: amount must be non-zero")

  if (amount > 0) {
    const balance = await fundWallet(userId, amount, "admin_grant", reason)
    return { balance, applied: amount, shortfall: 0 }
  }

  const result = await deductFromWallet(userId, -amount, "admin_grant", undefined, reason, {
    allowBelowMinimum: true,
    reduceLifetimeFunded: true,
  })
  try {
    await syncOpenRouterLimitsForUser(userId)
  } catch (err) {
    console.warn(
      `[billing] admin-adjust cap re-sync failed for user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return {
    balance: result.credits,
    applied: -(-amount - result.shortfall),
    shortfall: result.shortfall,
  }
}
