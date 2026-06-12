// Pure proration math for daily-compute refunds (no DB / no network, so it's
// unit-testable in isolation — see compute-proration.test.ts). Used by
// refundProratedDailyCompute in src/lib/daily-billing.ts.

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Credits to refund for a daily-compute charge of `dailyCostCredits` when the
 * agent is deleted `elapsedMs` after the charge: the unconsumed fraction of the
 * day, `dailyCost × max(0, 1 − elapsed/24h)`, rounded. Negative elapsed (clock
 * skew) clamps to a full refund; a non-positive/invalid cost refunds nothing.
 */
export function proratedRefundCredits(
  dailyCostCredits: number,
  elapsedMs: number,
  dayMs: number = DAY_MS,
): number {
  if (!Number.isFinite(dailyCostCredits) || dailyCostCredits <= 0) return 0
  const fraction = Math.max(0, 1 - Math.max(0, elapsedMs) / dayMs)
  return Math.round(dailyCostCredits * fraction)
}
