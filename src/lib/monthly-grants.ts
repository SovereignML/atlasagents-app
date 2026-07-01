// Monthly credit distribution for YEARLY plans.
//
// A yearly subscriber prepays 12 months up front, but we distribute their plan
// credits monthly so they match what a monthly subscriber gets: a fresh
// use-it-or-lose-it allotment each month rather than one lump that either
// under-funds them (one month's worth for a year) or lets a year's credits pile
// up. The first month is granted when the invoice is paid (handleInvoicePaid)
// and `Subscription.nextCreditGrantAt` is seeded a month out; this sweep tops it
// up every month until the annual period ends, at which point the renewal
// invoice re-seeds the schedule.
//
// Run it daily (cron → POST /api/billing/expire-credits runs it alongside the
// expiry sweep). Monthly subs are untouched — Stripe's monthly invoice is their
// renewal, so their `nextCreditGrantAt` stays null.

import { db, subscriptions, and, eq, lt, isNotNull } from "@/db"
import { depositPlanCreditsWithinTx } from "@/lib/wallet"
import { syncOpenRouterLimitsForUser } from "@/lib/openrouter-billing"
import { planPeriodEnd } from "@/lib/plan-period"

export type MonthlyGrantReport = {
  /** Active yearly subs whose next drip was due. */
  scanned: number
  /** Subs we actually deposited a monthly allotment for. */
  granted: number
  /** Total plan credits deposited across all subs. */
  creditsGranted: number
  errors: string[]
}

export async function runMonthlyCreditGrants(): Promise<MonthlyGrantReport> {
  const report: MonthlyGrantReport = {
    scanned: 0,
    granted: 0,
    creditsGranted: 0,
    errors: [],
  }

  const now = new Date()
  const due = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.interval, "year"),
      eq(subscriptions.status, "active"),
      isNotNull(subscriptions.nextCreditGrantAt),
      lt(subscriptions.nextCreditGrantAt, now),
    ),
    with: { plan: true },
  })

  for (const sub of due) {
    report.scanned++
    const credits = sub.plan?.creditsPerPeriod ?? 0
    if (credits <= 0) continue

    try {
      const granted = await db.transaction(async (tx) => {
        // Re-lock and re-check under the row lock so two overlapping cron runs
        // can't both grant the same month (the pointer is the claim).
        const [locked] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, sub.id))
          .for("update")
          .limit(1)
        if (
          !locked ||
          locked.status !== "active" ||
          locked.interval !== "year" ||
          !locked.nextCreditGrantAt ||
          locked.nextCreditGrantAt.getTime() > now.getTime()
        ) {
          return 0
        }

        // Past the prepaid annual window: stop dripping. The annual renewal
        // invoice re-seeds `nextCreditGrantAt`; until it arrives we grant nothing
        // (no free extra months if the renewal is late/failed).
        if (
          locked.currentPeriodEnd &&
          now.getTime() >= locked.currentPeriodEnd.getTime()
        ) {
          await tx
            .update(subscriptions)
            .set({ nextCreditGrantAt: null })
            .where(eq(subscriptions.id, sub.id))
          return 0
        }

        // Deposit this month's allotment. `depositPlanCreditsWithinTx` is
        // renewal semantics: expire last month's leftover, then add the fresh
        // allotment as the current use-it-or-lose-it bucket.
        const nextMonth = planPeriodEnd("month", now)
        await depositPlanCreditsWithinTx(
          tx,
          locked.userId,
          credits,
          nextMonth,
          `Monthly plan credit (annual): ${sub.plan?.name ?? "plan"}`,
          locked.instanceId ?? undefined,
        )

        // Advance the pointer. If the next drip would fall at/after the annual
        // period end, this was the last month — clear it and let the renewal
        // invoice re-seed the schedule.
        const nextPointer =
          locked.currentPeriodEnd &&
          nextMonth.getTime() >= locked.currentPeriodEnd.getTime()
            ? null
            : nextMonth
        await tx
          .update(subscriptions)
          .set({ nextCreditGrantAt: nextPointer })
          .where(eq(subscriptions.id, sub.id))

        return credits
      })

      if (granted > 0) {
        report.granted++
        report.creditsGranted += granted
        // Raise the OpenRouter cap to the now-larger balance (best-effort; the
        // usage poller and reconciler also converge it).
        try {
          await syncOpenRouterLimitsForUser(sub.userId)
        } catch (err) {
          report.errors.push(
            `cap-sync ${sub.userId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    } catch (err) {
      report.errors.push(
        `grant ${sub.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  console.log(JSON.stringify({ kind: "monthly_credit_grants", ...report }))
  return report
}
