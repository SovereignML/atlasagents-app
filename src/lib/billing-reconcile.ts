// Billing reconciliation — the correctness backstop for the credit ledger.
//
// Two independent passes, both read-only (detect-and-report, no auto-heal):
//
//   1. Ledger integrity — `Wallet.balance` MUST equal the running sum of its
//      `WalletTransaction.amount` rows. The wallet functions maintain this
//      invariant; any drift means a write bypassed them (a bug) and is worth
//      an admin alert.
//
//   2. OpenRouter usage drift — for each managed-credit key, the authoritative
//      cumulative spend OpenRouter reports should sit just AHEAD of our
//      per-instance pointer (`openRouterUsageUsd`): real usage accrues
//      continuously, the usage-sync poller charges + advances the pointer every
//      ~10 min, so a small positive gap (real − pointer) is normal. Two things
//      are NOT normal and get flagged:
//        - real − pointer is large and persistent → we're behind on charging
//          (a key not being polled, or usage-sync failing): "uncharged_usage".
//        - pointer − real is meaningfully positive → the pointer ran ahead of
//          reality, the signature of the double-charge bug usage-sync used to
//          have before the deduction + pointer advance were made atomic:
//          "pointer_ahead".
//
// Wire-up: run from the reconcile cron (see /api/admin/reconcile) and surface
// the report at /api/admin/billing/health.

import {
  db,
  wallets,
  walletTransactions,
  instances,
  adminNotifications,
  eq,
  and,
  isNotNull,
  desc,
  sql,
} from "@/db"
import { getRuntimeKey } from "@/lib/openrouter-provisioning"
import { OPENROUTER_MARGIN, creditsToUsd } from "@/lib/credit-pricing"
import { createAdminNotification } from "@/lib/admin-notify"

/** Credits of float-rounding slack before a ledger row counts as drifted. */
const LEDGER_TOLERANCE_CREDITS = 0.5

/** USD gap between real OpenRouter spend and our pointer before we flag it. */
const USAGE_DRIFT_USD = ((): number => {
  const raw = parseFloat(process.env.BILLING_DRIFT_USD ?? "")
  return Number.isFinite(raw) && raw > 0 ? raw : 1
})()

/** Cap on per-run OpenRouter key polls, to stay within API rate limits. */
const MAX_KEYS_PER_RUN = ((): number => {
  const raw = parseInt(process.env.BILLING_RECONCILE_MAX_KEYS ?? "", 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 250
})()

export type LedgerMismatch = {
  walletId: string
  userId: string
  balance: number
  ledgerSum: number
  /** balance − ledgerSum, in credits (positive = balance too high). */
  diffCredits: number
}

export type UsageDrift = {
  instanceId: string
  userId: string
  /** Authoritative cumulative spend OpenRouter reports for the key (USD). */
  realUsd: number
  /** Our last-charged pointer (USD). */
  pointerUsd: number
  /** realUsd − pointerUsd. */
  driftUsd: number
  /** Credits we've charged for this instance's API usage (context). */
  chargedCredits: number
  kind: "uncharged_usage" | "pointer_ahead"
}

/** Wallets where the float `balance` and the bigint `balanceCents` shadow
 *  column disagree — used to verify the dual-write before reads flip to bigint
 *  (Commit 3). Should be empty once Commit 2 has been live for a few days. */
export type BigintDrift = {
  walletId: string
  userId: string
  balance: number
  balanceCents: number
}

export type BillingReconcileReport = {
  walletsChecked: number
  ledgerMismatches: LedgerMismatch[]
  bigintDrift: BigintDrift[]
  keysPolled: number
  keysSkipped: number
  usageDrift: UsageDrift[]
  errors: string[]
  ranAt: string
}

/**
 * Cheap, OpenRouter-free check: every wallet's `balance` vs the running sum of
 * its ledger rows. HAVING filters to drifted rows server-side, so the result
 * set is tiny in the healthy case. Safe to call on a dashboard render.
 */
export async function checkLedgerIntegrity(): Promise<{
  walletsChecked: number
  mismatches: LedgerMismatch[]
}> {
  const total = await db.select({ n: sql<number>`count(*)` }).from(wallets)
  const walletsChecked = Number(total[0]?.n ?? 0)

  const rows = await db
    .select({
      walletId: wallets.id,
      userId: wallets.userId,
      balance: wallets.balance,
      ledgerSum: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)`,
    })
    .from(wallets)
    .leftJoin(walletTransactions, eq(walletTransactions.walletId, wallets.id))
    .groupBy(wallets.id)
    .having(
      sql`ABS(${wallets.balance} - COALESCE(SUM(${walletTransactions.amount}), 0)) > ${LEDGER_TOLERANCE_CREDITS}`,
    )

  const mismatches: LedgerMismatch[] = rows.map((m) => {
    const balance = Number(m.balance)
    const ledgerSum = Number(m.ledgerSum)
    return {
      walletId: m.walletId,
      userId: m.userId,
      balance,
      ledgerSum,
      diffCredits: Math.round((balance - ledgerSum) * 100) / 100,
    }
  })
  return { walletsChecked, mismatches }
}

/**
 * Cheap check that the bigint dual-write (Commit 2) tracks the authoritative
 * float column. Only compares rows where `balanceCents` is already set; a null
 * means the row hasn't been written since Commit 2 shipped and will backfill on
 * its next mutation, so it's not drift. Empty here is the green light to flip
 * reads to bigint and drop the float columns (Commit 3).
 */
export async function checkBigintDrift(): Promise<BigintDrift[]> {
  const rows = await db
    .select({
      walletId: wallets.id,
      userId: wallets.userId,
      balance: wallets.balance,
      balanceCents: wallets.balanceCents,
    })
    .from(wallets)
    .where(
      and(
        isNotNull(wallets.balanceCents),
        sql`${wallets.balanceCents} <> ROUND(${wallets.balance})::bigint`,
      ),
    )
  return rows.map((r) => ({
    walletId: r.walletId,
    userId: r.userId,
    balance: Number(r.balance),
    balanceCents: Number(r.balanceCents ?? 0),
  }))
}

export async function runBillingReconcile(): Promise<BillingReconcileReport> {
  const report: BillingReconcileReport = {
    walletsChecked: 0,
    ledgerMismatches: [],
    bigintDrift: [],
    keysPolled: 0,
    keysSkipped: 0,
    usageDrift: [],
    errors: [],
    ranAt: new Date().toISOString(),
  }

  // ── Pass 1: ledger integrity + bigint dual-write drift ──────────────────
  try {
    const ledger = await checkLedgerIntegrity()
    report.walletsChecked = ledger.walletsChecked
    report.ledgerMismatches = ledger.mismatches
  } catch (err) {
    report.errors.push(`ledger: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    report.bigintDrift = await checkBigintDrift()
  } catch (err) {
    report.errors.push(`bigint: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Pass 2: OpenRouter usage drift ──────────────────────────────────────
  // Skipped wholesale without the provisioning key (no way to read real usage).
  if (process.env.OPENROUTER_PROVISIONING_KEY) {
    try {
      // Credits charged per instance for API usage (context + sanity).
      const chargedRows = await db
        .select({
          instanceId: walletTransactions.instanceId,
          credits: sql<number>`COALESCE(SUM(-${walletTransactions.amount}), 0)`,
        })
        .from(walletTransactions)
        .where(eq(walletTransactions.type, "api_usage"))
        .groupBy(walletTransactions.instanceId)
      const chargedByInstance = new Map<string, number>()
      for (const r of chargedRows) {
        if (r.instanceId) chargedByInstance.set(r.instanceId, Number(r.credits))
      }

      const rows = await db.query.instances.findMany({
        where: and(
          isNotNull(instances.openRouterKeyId),
          sql`${instances.status} != 'deleted'`,
        ),
        columns: {
          id: true,
          userId: true,
          openRouterKeyId: true,
          openRouterUsageUsd: true,
          byosLlmMode: true,
        },
      })

      for (const row of rows) {
        if (row.byosLlmMode === "own_key" || !row.openRouterKeyId) continue
        if (report.keysPolled >= MAX_KEYS_PER_RUN) {
          report.keysSkipped++
          continue
        }

        let realUsd: number
        try {
          const state = await getRuntimeKey(row.openRouterKeyId)
          realUsd = state.usageUsd
          report.keysPolled++
        } catch (err) {
          report.errors.push(
            `poll ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          )
          continue
        }

        const pointerUsd = row.openRouterUsageUsd ?? 0
        const driftUsd = realUsd - pointerUsd
        if (Math.abs(driftUsd) <= USAGE_DRIFT_USD) continue

        report.usageDrift.push({
          instanceId: row.id,
          userId: row.userId,
          realUsd: Math.round(realUsd * 1e6) / 1e6,
          pointerUsd: Math.round(pointerUsd * 1e6) / 1e6,
          driftUsd: Math.round(driftUsd * 1e6) / 1e6,
          chargedCredits: chargedByInstance.get(row.id) ?? 0,
          kind: driftUsd > 0 ? "uncharged_usage" : "pointer_ahead",
        })
      }
    } catch (err) {
      report.errors.push(`usage: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(
    JSON.stringify({
      kind: "billing_reconcile",
      walletsChecked: report.walletsChecked,
      ledgerMismatches: report.ledgerMismatches.length,
      bigintDrift: report.bigintDrift.length,
      keysPolled: report.keysPolled,
      keysSkipped: report.keysSkipped,
      usageDrift: report.usageDrift.length,
      errors: report.errors.length,
    }),
  )
  return report
}

export type BillingHealthSnapshot = {
  walletsChecked: number
  ledgerMismatches: LedgerMismatch[]
  bigintDrift: BigintDrift[]
  totals: {
    /** Σ of all wallet balances — credits we owe customers. */
    outstandingCredits: number
    /** Σ of lifetime funded (net of reversals) — drives total OpenRouter cap. */
    lifetimeFundedCredits: number
  }
  /** Unresolved drift alerts raised by the last cron reconcile run. */
  openDrift: Array<{
    id: string
    userId: string
    message: string
    createdAt: Date
    meta: unknown
  }>
  ranAt: string
}

/**
 * Lightweight health snapshot for the admin dashboard / health endpoint. Does
 * the cheap SQL checks only (ledger integrity + wallet totals) and reads the
 * drift alerts the cron reconcile already persisted — never polls OpenRouter,
 * so it's safe on every page render. Run `runBillingReconcile()` (cron, or the
 * health endpoint with `?full=1`) for the live usage-drift scan.
 */
export async function getBillingHealthSnapshot(): Promise<BillingHealthSnapshot> {
  const [ledger, bigintDrift, agg, openDrift] = await Promise.all([
    checkLedgerIntegrity(),
    checkBigintDrift(),
    db
      .select({
        outstanding: sql<number>`COALESCE(SUM(${wallets.balance}), 0)`,
        funded: sql<number>`COALESCE(SUM(${wallets.lifetimeFundedCredits}), 0)`,
      })
      .from(wallets),
    db.query.adminNotifications.findMany({
      where: and(
        eq(adminNotifications.type, "billing_drift"),
        eq(adminNotifications.resolved, false),
      ),
      orderBy: desc(adminNotifications.createdAt),
      limit: 50,
      columns: { id: true, userId: true, message: true, createdAt: true, meta: true },
    }),
  ])

  return {
    walletsChecked: ledger.walletsChecked,
    ledgerMismatches: ledger.mismatches,
    bigintDrift,
    totals: {
      outstandingCredits: Math.round(Number(agg[0]?.outstanding ?? 0)),
      lifetimeFundedCredits: Math.round(Number(agg[0]?.funded ?? 0)),
    },
    openDrift,
    ranAt: new Date().toISOString(),
  }
}

/** Convenience for the UI: a one-line USD value of credits at our cost. */
export function chargedCreditsToCostUsd(credits: number): number {
  return creditsToUsd(credits) * OPENROUTER_MARGIN
}

/**
 * Raise admin notifications for the SERIOUS findings in a reconcile report:
 * every ledger mismatch (always a bug) and any "pointer_ahead" / very-large
 * usage drift (over-charge signature or a stuck/un-polled key). Transient
 * "uncharged_usage" within a few intervals of usage-sync is left to the
 * dashboard — it self-resolves on the next poll.
 *
 * De-duped per user: if an unresolved `billing_drift` notification already
 * exists for that user we don't pile on, so a persistent drift doesn't spam the
 * admin queue every cron tick. Returns how many notifications were created.
 */
export async function alertBillingReconcile(
  report: BillingReconcileReport,
): Promise<number> {
  const seriousByUser = new Map<string, string[]>()
  const add = (userId: string, line: string) => {
    const list = seriousByUser.get(userId) ?? []
    list.push(line)
    seriousByUser.set(userId, list)
  }

  for (const m of report.ledgerMismatches) {
    add(
      m.userId,
      `wallet ${m.walletId}: balance ${m.balance} ≠ ledger sum ${m.ledgerSum} (off by ${m.diffCredits} cr)`,
    )
  }
  for (const d of report.usageDrift) {
    const serious = d.kind === "pointer_ahead" || d.driftUsd > USAGE_DRIFT_USD * 5
    if (!serious) continue
    add(
      d.userId,
      `instance ${d.instanceId}: ${d.kind} — real $${d.realUsd} vs pointer $${d.pointerUsd} (drift $${d.driftUsd})`,
    )
  }

  let created = 0
  for (const [userId, lines] of seriousByUser) {
    const existing = await db.query.adminNotifications.findMany({
      where: and(
        eq(adminNotifications.type, "billing_drift"),
        eq(adminNotifications.userId, userId),
        eq(adminNotifications.resolved, false),
      ),
      columns: { id: true },
      limit: 1,
    })
    if (existing.length > 0) continue

    await createAdminNotification({
      type: "billing_drift",
      userId,
      message: `Billing reconciliation found ${lines.length} issue(s): ${lines.join("; ")}. Investigate and reconcile manually.`,
      meta: { findings: lines, ranAt: report.ranAt },
    })
    created++
  }
  return created
}
