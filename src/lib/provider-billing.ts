// Internal-budget tracking for the VPS provider router.
//
// "Credit" here is NOT a provider account balance — it's a budget WE configure
// per provider in `provider_billing` (monthlyCreditsUsd, soft/hard limits). The
// router treats this as the source of truth and never calls a provider balance
// API. Usage accrues as instances are charged their daily compute cost
// (src/lib/daily-billing.ts), and burn rate / cycle resets are recomputed by
// runProviderBillingSync().

import { db, providers, providerBilling, eq, sql } from "@/db"

const DAY_MS = 24 * 60 * 60 * 1000

export type ProviderBudget = {
  providerId: string
  monthlyCreditsUsd: number
  currentUsageUsd: number
  softLimitUsd: number | null
  hardLimitUsd: number | null
  burnRateUsdPerDay: number
  remainingUsd: number
}

function toBudget(row: typeof providerBilling.$inferSelect): ProviderBudget {
  return {
    providerId: row.providerId,
    monthlyCreditsUsd: row.monthlyCreditsUsd,
    currentUsageUsd: row.currentUsageUsd,
    softLimitUsd: row.softLimitUsd ?? null,
    hardLimitUsd: row.hardLimitUsd ?? null,
    burnRateUsdPerDay: row.burnRateUsdPerDay,
    remainingUsd: Math.max(0, row.monthlyCreditsUsd - row.currentUsageUsd),
  }
}

/** Budget row for one provider, or null if none configured. */
export async function getProviderBudget(providerId: string): Promise<ProviderBudget | null> {
  const row = await db.query.providerBilling.findFirst({
    where: eq(providerBilling.providerId, providerId),
  })
  return row ? toBudget(row) : null
}

/** All budget rows, keyed by providerId — used by the router to avoid N queries. */
export async function getAllProviderBudgets(): Promise<Map<string, ProviderBudget>> {
  const rows = await db.query.providerBilling.findMany()
  return new Map(rows.map((r) => [r.providerId, toBudget(r)]))
}

/** Remaining USD for a provider identified by slug. Backs VpsProvider.getRemainingCredit(). */
export async function getRemainingCreditBySlug(slug: string): Promise<number | null> {
  const provider = await db.query.providers.findFirst({
    where: eq(providers.slug, slug),
    columns: { id: true },
  })
  if (!provider) return null
  const budget = await getProviderBudget(provider.id)
  return budget ? budget.remainingUsd : null
}

/**
 * Accrue USD spend against a provider's current cycle. Atomic increment so
 * concurrent daily-billing passes don't clobber each other. No-op for a
 * provider with no budget row.
 */
export async function accrueProviderUsage(providerId: string, usd: number): Promise<void> {
  if (!(usd > 0)) return
  await db
    .update(providerBilling)
    .set({ currentUsageUsd: sql`${providerBilling.currentUsageUsd} + ${usd}` })
    .where(eq(providerBilling.providerId, providerId))
}

export type ProviderBillingSyncReport = {
  providersProcessed: number
  cyclesReset: number
}

/**
 * Recompute burn rate for every provider, and roll the cycle over (reset
 * currentUsage + cycleStart) once a provider's cycle exceeds ~30 days. Safe to
 * run daily from the reconcile cron.
 */
export async function runProviderBillingSync(): Promise<ProviderBillingSyncReport> {
  const rows = await db.query.providerBilling.findMany()
  const now = Date.now()
  let cyclesReset = 0

  for (const row of rows) {
    const cycleStart = row.cycleStart?.getTime() ?? now
    const daysElapsed = Math.max(1, (now - cycleStart) / DAY_MS)

    if (daysElapsed >= 30) {
      // New cycle — reset usage, restart the clock. Burn rate carries the last
      // cycle's average forward as a starting estimate.
      await db
        .update(providerBilling)
        .set({
          currentUsageUsd: 0,
          burnRateUsdPerDay: row.currentUsageUsd / daysElapsed,
          cycleStart: new Date(now),
        })
        .where(eq(providerBilling.id, row.id))
      cyclesReset++
    } else {
      await db
        .update(providerBilling)
        .set({ burnRateUsdPerDay: row.currentUsageUsd / daysElapsed })
        .where(eq(providerBilling.id, row.id))
    }
  }

  return { providersProcessed: rows.length, cyclesReset }
}
