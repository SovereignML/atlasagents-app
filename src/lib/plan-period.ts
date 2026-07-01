// Pure helper for plan-credit expiry timing (no DB / no network).
//
// The canonical expiry for a plan deposit is the subscription's
// `currentPeriodEnd` (set by Stripe). But the FIRST period's credits are
// granted at deploy/restore time — before Stripe has populated that field — and
// the dev/free paths have no Stripe period at all. For those we derive the
// period end from the billing interval so the bucket still has an expiry the
// sweep can act on. Renewals overwrite it with the real Stripe period end.

/** End of the current billing period given the interval, from `from`. */
export function planPeriodEnd(interval: string, from: Date = new Date()): Date {
  const d = new Date(from)
  if (interval === "year") {
    d.setFullYear(d.getFullYear() + 1)
  } else {
    d.setMonth(d.getMonth() + 1)
  }
  return d
}

/**
 * Schedule for the FIRST credit grant of a subscription period.
 *
 * Monthly plans bill monthly, so the whole allotment lands now and expires at
 * the (Stripe) period end — there's no separate drip (`nextCreditGrantAt` null).
 *
 * Yearly plans prepay 12 months up front, but we DISTRIBUTE the allotment
 * monthly to match what a monthly subscriber gets: grant one month's worth now
 * (expiring in a month, use-it-or-lose-it) and schedule the next monthly drip a
 * month out. The monthly-grants sweep (src/lib/monthly-grants.ts) tops it up
 * each month until the annual period ends and the renewal invoice re-seeds it.
 *
 * `periodEnd` is the Stripe-provided period end when known (monthly only); for
 * the dev/free paths with no Stripe period we derive it from the interval.
 */
export function creditGrantSchedule(
  interval: string,
  periodEnd: Date | null,
  from: Date = new Date(),
): { expireAt: Date; nextCreditGrantAt: Date | null } {
  if (interval === "year") {
    const nextMonth = planPeriodEnd("month", from)
    return { expireAt: nextMonth, nextCreditGrantAt: nextMonth }
  }
  return {
    expireAt: periodEnd ?? planPeriodEnd("month", from),
    nextCreditGrantAt: null,
  }
}
