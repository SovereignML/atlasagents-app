// Use-it-or-lose-it plan-credit expiry sweep.
//
// Monthly `plan_deposit` credits are tracked in a per-wallet bucket
// (`Wallet.planCredits` / `planCreditsExpireAt`) and expire at the
// subscription's period end. The normal renewal path already expires the prior
// period's leftover when it deposits the new allotment (see
// `depositPlanCreditsWithinTx`). This sweep is the safety net for wallets that
// get NO renewal deposit — cancelled or lapsed subscriptions — whose plan
// credits would otherwise linger forever. It also makes expiry timely rather
// than only-on-next-deposit.
//
// Run it on a schedule (cron → POST /api/billing/expire-credits). Purchased
// top-ups, admin grants, and refunds are persistent and never touched here.

import { db, wallets, and, lt, gt, isNotNull } from "@/db"
import { expirePlanCreditsWithinTx } from "@/lib/wallet"
import { syncOpenRouterLimitsForUser } from "@/lib/openrouter-billing"

export type CreditExpiryReport = {
  /** Wallets past their plan-credit expiry with a non-empty bucket. */
  scanned: number
  /** Wallets we actually expired credits for. */
  expired: number
  /** Total plan credits removed across all wallets. */
  creditsExpired: number
  errors: string[]
}

export async function runCreditExpiry(): Promise<CreditExpiryReport> {
  const report: CreditExpiryReport = {
    scanned: 0,
    expired: 0,
    creditsExpired: 0,
    errors: [],
  }

  const now = new Date()
  const due = await db.query.wallets.findMany({
    where: and(
      isNotNull(wallets.planCreditsExpireAt),
      lt(wallets.planCreditsExpireAt, now),
      gt(wallets.planCredits, 0),
    ),
    columns: { userId: true },
  })

  for (const w of due) {
    report.scanned++
    try {
      // Re-locks the wallet and re-checks the bucket inside the txn, so a
      // concurrent renewal/spend can't cause a double expiry or a stale read.
      const expired = await db.transaction((tx) => expirePlanCreditsWithinTx(tx, w.userId))
      if (expired > 0) {
        report.expired++
        report.creditsExpired += expired
        // Lower the OpenRouter cap to the now-smaller balance (best-effort;
        // the usage poller and reconciler also converge it).
        try {
          await syncOpenRouterLimitsForUser(w.userId)
        } catch (err) {
          report.errors.push(
            `cap-sync ${w.userId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    } catch (err) {
      report.errors.push(
        `expire ${w.userId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  console.log(JSON.stringify({ kind: "credit_expiry", ...report }))
  return report
}
