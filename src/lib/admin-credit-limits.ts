/**
 * Limits on manual credit adjustments by platform admins
 * (POST /api/admin/billing/adjust). Credits are money (1 credit = $0.01), and
 * one call used to accept ±1,000,000 credits ($10,000) with no rate limit and
 * no running total, so one fat-fingered or compromised admin session could
 * hand out unbounded credit.
 *
 *   ADMIN_ADJUST_MAX_CREDITS    per call, either sign       default 100,000 ($1,000)
 *   ADMIN_ADJUST_DAILY_CREDITS  grants per admin per 24h    default 250,000 ($2,500)
 *   ADMIN_ADJUST_ALERT_CREDITS  raise an admin notification default  25,000 ($250)
 *
 * Removals (negative adjustments) settle debts, so only grants count toward
 * the daily total; both directions obey the per-call limit.
 */

export type AdminCreditLimits = { perCall: number; dailyGrants: number; alertAt: number }

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function adminCreditLimits(): AdminCreditLimits {
  return {
    perCall: envInt("ADMIN_ADJUST_MAX_CREDITS", 100_000),
    dailyGrants: envInt("ADMIN_ADJUST_DAILY_CREDITS", 250_000),
    alertAt: envInt("ADMIN_ADJUST_ALERT_CREDITS", 25_000),
  }
}

/** Why this adjustment is refused, or null if it may proceed. */
export function adjustmentRefusal(
  credits: number,
  grantedLast24h: number,
  limits: AdminCreditLimits,
): string | null {
  if (Math.abs(credits) > limits.perCall) {
    return `One adjustment can move at most ${limits.perCall.toLocaleString("en-US")} credits.`
  }
  if (credits > 0 && grantedLast24h + credits > limits.dailyGrants) {
    const left = Math.max(0, limits.dailyGrants - grantedLast24h)
    return (
      `That would take your grants in the last 24 hours past ${limits.dailyGrants.toLocaleString("en-US")} ` +
      `credits; ${left.toLocaleString("en-US")} left. Another admin, or a raised ADMIN_ADJUST_DAILY_CREDITS, can do the rest.`
    )
  }
  return null
}
