import {
  db,
  instances,
  walletTransactions,
  warmVms,
  and,
  eq,
  gt,
  desc,
  inArray,
  sql,
} from "@/db"
import { deductWithinTx, depositWithinTx } from "@/lib/wallet"
import type { InferSelectModel } from "drizzle-orm"
import { accrueProviderUsage } from "@/lib/provider-billing"
import { createAdminNotification } from "@/lib/admin-notify"
import { notify } from "@/lib/notifications/dispatch"
import { usdToCredits, formatCredits } from "@/lib/credit-pricing"
import { proratedRefundCredits, DAY_MS } from "@/lib/compute-proration"
import { claimEventOn, releaseEvent } from "@/lib/idempotency"
import { maybeWarnLowBalance } from "@/lib/low-balance"

const DAYS_PER_MONTH = 30

export type DailyBillingReport = {
  processed: number
  charged: number
  stopped: number
  /** Instances already billed for this day (idempotent re-run / double trigger). */
  alreadyBilled: number
  errors: string[]
  billingDay: string
  /** Warm-pool compute accrued against provider budgets this run. */
  pool: WarmPoolBillingReport
}

export type WarmPoolBillingReport = {
  /** Live (unclaimed) pool VMs considered. */
  processed: number
  /** Pool VMs whose daily cost was accrued this run. */
  charged: number
  /** Pool VMs already accrued for this day (idempotent re-run). */
  alreadyBilled: number
  /** Pool VMs with no resolvable provider/plan cost — accrued nothing. */
  skippedNoCost: number
  /** Total USD accrued against provider budgets for the pool this run. */
  usdAccrued: number
}

/**
 * Runs daily billing for all running instances. For each instance the
 * daily cost is `serverConfig.priceMonthly / 30` (USD), converted to
 * credits and deducted from the owner's wallet. If the wallet can't
 * cover the charge the instance is paused and an admin notification is
 * created.
 *
 * Idempotency: a PER-INSTANCE claim key (`daily_billing:<day>:<instanceId>`)
 * is taken inside the same transaction as that instance's deduction, so the
 * claim and the charge commit together. A mid-loop crash (or a double trigger
 * — cron retry, manual admin run, k8s job restart) re-runs cleanly: instances
 * already billed are skipped, the rest get charged exactly once. We derive the
 * billing day from `now - 60s` so a cron scheduled near midnight UTC doesn't
 * land in two different days on retry. Schedule the cron well away from
 * midnight (e.g. 03:00 UTC) for extra safety.
 */
export async function runDailyBilling(): Promise<DailyBillingReport> {
  const billingDay = new Date(Date.now() - 60_000).toISOString().slice(0, 10)

  const report: DailyBillingReport = {
    processed: 0,
    charged: 0,
    stopped: 0,
    alreadyBilled: 0,
    errors: [],
    billingDay,
    pool: { processed: 0, charged: 0, alreadyBilled: 0, skippedNoCost: 0, usdAccrued: 0 },
  }

  const runningInstances = await db.query.instances.findMany({
    where: sql`${instances.status} = 'running'`,
    with: { serverConfig: true },
  })

  for (const instance of runningInstances) {
    report.processed++

    // BYOS: we don't own the server, so there is no compute cost to deduct.
    // Revenue for these instances comes entirely from the management-panel
    // Stripe subscription; LLM usage (managed_credits) is metered separately.
    if (instance.deploymentTarget === "byos") continue

    const dailyCostUsd = instance.serverConfig.priceMonthly / DAYS_PER_MONTH
    const dailyCostCredits = usdToCredits(dailyCostUsd)
    if (dailyCostCredits <= 0) continue

    const eventId = `${billingDay}:${instance.id}`

    try {
      // Claim + charge atomically. Three outcomes:
      //   - "already_billed": the per-instance claim already exists → no-op.
      //   - { ok: true }:     charged this run.
      //   - { ok: false }:    insufficient balance — the claim still commits,
      //                       because the plan is to handle this instance today
      //                       by pausing it. If that pause then FAILS we
      //                       release the claim by hand (below), so the next
      //                       run retries instead of leaving it running free.
      // A thrown DB error rolls back BOTH the claim and the charge, so the
      // instance is retried on the next run (at-least-once + idempotent).
      const result = await db.transaction(async (tx) => {
        const claimed = await claimEventOn(tx, "daily_billing", eventId, {
          instanceId: instance.id,
          dailyCostCredits,
        })
        if (!claimed) return "already_billed" as const
        return deductWithinTx(
          tx,
          instance.userId,
          dailyCostCredits,
          "daily_compute",
          instance.id,
          `Daily compute: ${instance.name} (${instance.serverConfig.label})`,
        )
      })

      if (result === "already_billed") {
        report.alreadyBilled++
        continue
      }

      if (result.ok) {
        report.charged++
        // Attribute this compute cost to the provider that hosts the VM, so the
        // router's internal budget / burn rate stays accurate. Null for
        // legacy/shared rows — accrueProviderUsage is a no-op then. Best-effort
        // (outside the billing tx): a miss only nudges our internal burn-rate
        // estimate, never user money, and runProviderBillingSync re-derives it.
        if (instance.providerId) {
          try {
            await accrueProviderUsage(instance.providerId, dailyCostUsd)
          } catch (err) {
            report.errors.push(
              `accrueProviderUsage ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
        // Proactive low-balance nudge (self-gated to the warning band + once/day).
        try {
          await maybeWarnLowBalance(instance.userId)
        } catch (err) {
          report.errors.push(
            `warn ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        continue
      }

      // Insufficient balance -- pause the instance.
      //
      // The claim above has already COMMITTED (an `ok: false` deduction is a
      // normal return, not a throw), and nothing here is inside a transaction.
      // So if the pause fails we must release the claim by hand, or this
      // instance is marked "handled today" while still running: no charge
      // taken, agent up, and the next run's claim short-circuits as
      // `already_billed`. That is a free day of compute per failure, silently.
      //
      // Release-on-failure is the same claim-with-release contract the rest of
      // the system uses (see `src/lib/idempotency.ts`) — it is safe here
      // precisely because `ok: false` means no money moved, so a retry cannot
      // double-charge. The successful-deduct path above keeps its claim and
      // must continue to.
      try {
        const { pauseBot } = await import("@/lib/provisioner")
        await pauseBot(instance)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        report.errors.push(`pauseBot failed for ${instance.id}: ${msg}`)

        try {
          await releaseEvent("daily_billing", eventId)
        } catch (releaseErr) {
          // Nothing left to do but say so loudly: the claim stands, so this
          // instance will not be retried today.
          const rmsg =
            releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
          report.errors.push(
            `releaseEvent failed for ${instance.id} (instance runs unbilled until ${billingDay} rolls over): ${rmsg}`,
          )
        }

        // Skip the log, the notifications and `report.stopped` — the instance
        // was NOT stopped. Asserting otherwise puts "Instance stopped." in the
        // user's event log for an agent that is still running, and burns the
        // low-balance notification that the successful retry should send.
        continue
      }

      const { logInstanceEvent } = await import("@/lib/instance-state")
      await logInstanceEvent({
        instanceId: instance.id,
        level: "warn",
        stage: "billing",
        action: "insufficient_balance",
        message: `Credit balance (${formatCredits(result.credits)}) too low for daily charge (${formatCredits(dailyCostCredits)}). Instance stopped.`,
      })

      await createAdminNotification({
        type: "low_balance",
        userId: instance.userId,
        instanceId: instance.id,
        message: `Instance "${instance.name}" stopped due to low credit balance (${formatCredits(result.credits)}). Daily cost: ${formatCredits(dailyCostCredits)}.`,
        meta: { credits: result.credits, dailyCostCredits },
      })

      await notify({
        userId: instance.userId,
        category: "billing",
        type: "low_balance",
        title: `Agent "${instance.name}" was paused`,
        message: `Your credit balance (${formatCredits(result.credits)}) is too low to cover today's compute cost (${formatCredits(dailyCostCredits)}). Add credits to resume.`,
        url: "/dashboard/billing",
        instanceId: instance.id,
      })

      report.stopped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`billing failed for ${instance.id}: ${msg}`)
    }
  }

  // Warm-pool compute: pre-baked VMs cost real provider money but carry no user
  // instance to bill, so without this they stay invisible to the provider budget
  // / burn rate. Accrue their daily provider cost here (best-effort — a failure
  // only nudges the internal estimate, never user money).
  try {
    await accrueWarmPoolCompute(billingDay, report.pool)
  } catch (err) {
    report.errors.push(
      `warm-pool accrual: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return report
}

/** Non-claimed pool statuses whose droplet exists at the provider and bills. */
const BILLABLE_POOL_STATUSES = ["creating", "bootstrapping", "ready", "failed"] as const

/**
 * Accrue one day of compute for each live warm-pool VM against the budget of the
 * provider that hosts it, so pre-baked capacity shows up in provider
 * currentUsage / burn rate (runProviderBillingSync re-derives the rate).
 *
 * Cost basis is `providerPlans.monthlyCostUsd` — OUR real per-plan cost at the
 * provider — since a pool VM has no retail price. `claimed` VMs are excluded:
 * once claimed they belong to an Instance that runDailyBilling charges above, so
 * counting them here would double-bill the provider budget.
 *
 * Idempotency: a per-VM-per-day claim (`pool_compute:<day>:<warmVmId>`) makes a
 * re-run (cron retry / manual admin run) a no-op. Claim-first, then accrue: a
 * crash mid-accrual loses at most one VM-day of an internal estimate that the
 * next cycle resets — far cheaper than the double-accrual a claim-on-success
 * retry would risk.
 */
async function accrueWarmPoolCompute(
  billingDay: string,
  report: WarmPoolBillingReport,
): Promise<void> {
  const vms = await db.query.warmVms.findMany({
    where: inArray(warmVms.status, [...BILLABLE_POOL_STATUSES]),
    columns: { id: true, providerId: true, providerPlanCode: true },
  })
  if (vms.length === 0) return

  // Resolve per-provider plan cost once: `${providerId}|${planCode}` → USD/month.
  const plans = await db.query.providerPlans.findMany({
    columns: { providerId: true, providerPlanCode: true, monthlyCostUsd: true },
  })
  const costByKey = new Map(
    plans.map((p) => [`${p.providerId}|${p.providerPlanCode}`, p.monthlyCostUsd]),
  )

  for (const vm of vms) {
    report.processed++

    // No hosting provider (legacy row) or no priced plan → nothing to attribute.
    const monthlyCostUsd = vm.providerId
      ? costByKey.get(`${vm.providerId}|${vm.providerPlanCode}`)
      : undefined
    const dailyCostUsd = (monthlyCostUsd ?? 0) / DAYS_PER_MONTH
    if (!vm.providerId || !(dailyCostUsd > 0)) {
      report.skippedNoCost++
      continue
    }

    const eventId = `${billingDay}:${vm.id}`
    try {
      const claimed = await claimEventOn(db, "pool_compute", eventId, {
        warmVmId: vm.id,
        dailyCostUsd,
      })
      if (!claimed) {
        report.alreadyBilled++
        continue
      }
      await accrueProviderUsage(vm.providerId, dailyCostUsd)
      report.charged++
      report.usdAccrued += dailyCostUsd
    } catch {
      // Best-effort per VM: a transient DB error here only nudges an internal
      // estimate. Leave this VM for the next run (the claim is idempotent) and
      // keep accruing the rest rather than aborting the whole pass.
      report.skippedNoCost++
    }
  }
}


/**
 * Refund the unused portion of today's daily-compute charge when an agent is
 * deleted mid-day. Daily compute is billed a full day up-front (see
 * `runDailyBilling`), so deleting partway through should return the slice not
 * consumed: `dailyCost × (1 − elapsedSinceCharge / 24h)`.
 *
 * Best-effort and idempotent: a per-instance claim (`daily_refund:<instanceId>`)
 * commits in the same transaction as the deposit, so deleteBot retries (the
 * reconciler re-runs deletions) never double-refund. The refund tops up the
 * persistent balance (skipLifetimeFunded — it was never new funding) and does
 * not touch the plan bucket. Never throws — a refund miss must not block
 * teardown. Returns the credits refunded (0 if nothing to refund).
 */
export async function refundProratedDailyCompute(
  instance: Pick<
    InferSelectModel<typeof instances>,
    "id" | "userId" | "name" | "deploymentTarget"
  >,
): Promise<number> {
  // BYOS instances carry no platform compute charge (see runDailyBilling).
  if (instance.deploymentTarget === "byos") return 0

  try {
    const now = Date.now()
    const since = new Date(now - DAY_MS)
    // Most recent daily_compute charge for this instance within the last day.
    const charge = await db.query.walletTransactions.findFirst({
      where: and(
        eq(walletTransactions.instanceId, instance.id),
        eq(walletTransactions.type, "daily_compute"),
        gt(walletTransactions.createdAt, since),
      ),
      orderBy: desc(walletTransactions.createdAt),
      columns: { amount: true, createdAt: true },
    })
    if (!charge) return 0

    // The ledger stores the charge as a negative amount.
    const dailyCostCredits = Math.abs(Math.round(charge.amount))
    if (dailyCostCredits <= 0) return 0

    const elapsedMs = now - new Date(charge.createdAt).getTime()
    const refundCredits = proratedRefundCredits(dailyCostCredits, elapsedMs)
    if (refundCredits <= 0) return 0

    return await db.transaction(async (tx) => {
      // One refund per instance, ever — robust to multi-day deleteBot retries.
      const claimed = await claimEventOn(tx, "daily_refund", instance.id, {
        instanceId: instance.id,
        refundCredits,
      })
      if (!claimed) return 0
      await depositWithinTx(
        tx,
        instance.userId,
        refundCredits,
        "compute_refund",
        `Prorated compute refund on delete: ${instance.name}`,
        instance.id,
        { skipLifetimeFunded: true },
      )
      return refundCredits
    })
  } catch (err) {
    console.warn(
      `[daily-billing] prorated refund failed for ${instance.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return 0
  }
}
