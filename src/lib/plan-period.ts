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
