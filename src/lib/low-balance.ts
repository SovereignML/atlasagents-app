// Proactive low-balance warning — the tier BEFORE the hard auto-pause.
//
// The wallet minimum (`minimumBalance`) is the floor at which agents get paused
// (daily-billing / usage-sync enforce it). That's the emergency brake. This
// nudge fires earlier — when the balance dips into the band between the floor
// and `floor × LOW_BALANCE_WARN_MULTIPLIER` — so a user can top up before
// anything stops. De-duped to at most one warning per user per day so a busy
// usage-sync cadence can't spam them.

import { db, wallets, eq } from "@/db"
import { claimEvent, releaseEvent } from "@/lib/idempotency"
import { notify, nothingDelivered } from "@/lib/notifications/dispatch"
import { formatCredits } from "@/lib/credit-pricing"

const WARN_MULTIPLIER = ((): number => {
  const raw = parseFloat(process.env.LOW_BALANCE_WARN_MULTIPLIER ?? "")
  return Number.isFinite(raw) && raw > 1 ? raw : 2
})()

/**
 * Send a "running low" notification if the user's balance is in the warning
 * band (above the pause floor, at/below floor × multiplier) and we haven't
 * already warned them today. Returns true if a warning was sent. Safe to call
 * after any deduction; it self-gates on the band and the daily dedup.
 */
export async function maybeWarnLowBalance(userId: string): Promise<boolean> {
  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
    columns: { balance: true, minimumBalance: true },
  })
  if (!wallet) return false

  const balance = Math.round(wallet.balance)
  const minimum = Math.round(wallet.minimumBalance)
  const warnAt = Math.round(minimum * WARN_MULTIPLIER)

  // Only the approaching band. At/below the floor, the pause notification
  // (from daily-billing / usage-sync enforcement) is the right message.
  if (balance <= minimum || balance > warnAt) return false

  // Claim-with-release: the claim stops a busy usage-sync cadence from sending
  // twice, and is released if nothing was delivered, so the next check retries
  // instead of the warning being lost for the day.
  const day = new Date().toISOString().slice(0, 10)
  const key = `${userId}:${day}`
  const claimed = await claimEvent("low_balance_warning", key)
  if (!claimed) return false

  const result = await notify({
    userId,
    category: "billing",
    type: "low_balance_warning",
    title: "Credit balance running low",
    message: `Your balance is ${formatCredits(balance)} and agents pause at ${formatCredits(
      minimum,
    )}. Top up to avoid interruption.`,
    url: "/dashboard/billing",
  })
  if (nothingDelivered(result)) {
    await releaseEvent("low_balance_warning", key)
    return false
  }
  return true
}
