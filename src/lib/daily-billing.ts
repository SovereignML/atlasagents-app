import { db, instances, sql } from "@/db"
import { deductWithinTx } from "@/lib/wallet"
import { accrueProviderUsage } from "@/lib/provider-billing"
import { createAdminNotification } from "@/lib/admin-notify"
import { notify } from "@/lib/notifications/dispatch"
import { usdToCredits, formatCredits } from "@/lib/credit-pricing"
import { claimEventOn } from "@/lib/idempotency"
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
      //   - { ok: false }:    insufficient balance — the claim still commits
      //                       (we handled this instance today by pausing it),
      //                       so we don't re-bill on the next run.
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
      try {
        const { pauseBot } = await import("@/lib/provisioner")
        await pauseBot(instance)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        report.errors.push(`pauseBot failed for ${instance.id}: ${msg}`)
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

  return report
}
