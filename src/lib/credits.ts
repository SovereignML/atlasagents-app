// Legacy credit helpers — kept so existing call sites compile, but all
// operations now route through the wallet (the SINGLE balance per user).
//
// `User.credits` is no longer the source of truth; treat it as deprecated.
// New code should import from `@/lib/wallet` directly.

import { deductFromWallet, getWalletCredits } from "@/lib/wallet"
import { fundWallet } from "@/lib/openrouter-billing"

export type ConsumeResult =
  | { ok: true; balance: number }
  | { ok: false; balance: number }

/**
 * Grant credits to a user. Deposits into the wallet ledger and returns
 * the new credit balance.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<number> {
  // fundWallet = deposit + raise/re-enable the user's OpenRouter key caps.
  return fundWallet(userId, amount, "admin_grant", reason)
}

/**
 * Consume credits. Returns `{ ok: false }` instead of throwing if the
 * user's balance would drop below the minimum.
 */
export async function consumeCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<ConsumeResult> {
  const result = await deductFromWallet(userId, amount, "api_usage", undefined, reason)
  return result.ok
    ? { ok: true, balance: result.credits }
    : { ok: false, balance: result.credits }
}

/** Read the current credit balance for a user. */
export async function getBalance(userId: string): Promise<number> {
  return getWalletCredits(userId)
}
