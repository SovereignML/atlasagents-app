/**
 * Credit pricing — the SINGLE source of truth for "how much is a credit".
 *
 * Rule: 1 credit = $0.01 USD.
 *
 * Plans, top-ups, daily compute, and API usage all use this rate. Anywhere
 * the app stores a balance or charges for usage, it's in integer credits.
 *
 * `Wallet.balance` is `doublePrecision` for legacy reasons, but we only
 * write whole numbers (credits) to it. There's a backfill helper in
 * `scripts/migrate-wallets-to-credits.ts` for environments that still
 * hold USD-denominated balances.
 */
export const CREDITS_PER_USD = 100

/** Default minimum balance buffer before instances get paused (~$2). */
export const DEFAULT_MIN_CREDITS = 200

/** Minimum top-up purchase (~$5). */
export const MIN_TOPUP_CREDITS = 500

/**
 * Margin on OpenRouter spend. We cap each per-instance OpenRouter key at this
 * fraction of the USD the customer has funded, so OpenRouter can never bill us
 * more than `OPENROUTER_MARGIN` of revenue — a guaranteed gross margin of
 * `1 - OPENROUTER_MARGIN` (10% at 0.9), enforced on OpenRouter's side.
 *
 * Equivalently, when we charge the wallet for real OpenRouter usage we mark it
 * up by `1 / OPENROUTER_MARGIN` (see `openRouterUsdToCredits`). The two are
 * duals: cap = funded × margin, and charge = realUsage ÷ margin. By
 * construction the wallet always covers the marked-up real usage exactly.
 *
 * Override via the OPENROUTER_MARGIN env var (e.g. "0.85" for a 15% margin).
 * Clamped to (0, 1]; anything outside that or unparseable falls back to 0.9.
 */
export const OPENROUTER_MARGIN = ((): number => {
  const raw = parseFloat(process.env.OPENROUTER_MARGIN ?? "")
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return 0.9
  return raw
})()

export function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0
  return Math.round(usd * CREDITS_PER_USD)
}

export function creditsToUsd(credits: number): number {
  if (!Number.isFinite(credits)) return 0
  return credits / CREDITS_PER_USD
}

/**
 * The USD spend cap to set on a user's OpenRouter key(s), given the lifetime
 * credits they've funded. Cumulative (matches OpenRouter's lifetime
 * `usage`/`limit` semantics) — raised on every funding event, never lowered.
 */
export function keyLimitUsdFromCredits(fundedCredits: number): number {
  return creditsToUsd(fundedCredits) * OPENROUTER_MARGIN
}

/**
 * Convert real OpenRouter spend (USD) into the credits to deduct from the
 * wallet, marked up by the margin. `$0.90` of real usage at a 0.9 margin
 * charges `100` credits ($1.00).
 */
export function openRouterUsdToCredits(realUsd: number): number {
  if (!Number.isFinite(realUsd) || realUsd <= 0) return 0
  return usdToCredits(realUsd / OPENROUTER_MARGIN)
}

export function formatCredits(credits: number): string {
  return `${Math.round(credits).toLocaleString("en-US")} cr`
}

export function formatCreditsAsUsd(credits: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(creditsToUsd(credits))
}
