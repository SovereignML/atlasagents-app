// OpenRouter real-usage credit billing.
//
// Periodically (cron → POST /api/billing/usage-sync) polls each managed-credit
// instance's OpenRouter key for its cumulative real spend, charges the wallet
// for the delta since the last poll (marked up by the margin), and advances a
// per-instance pointer. When a key drains the wallet, hits its cap, or spikes
// anomalously, it disables the key + pauses the bot + notifies.
//
// This REPLACES the synthetic per-request/token metering that used to live in
// /api/usage/ingest. The per-key OpenRouter cap (= this key's usage + the
// user's current balance × margin) is the hard floor on our cost; this poller
// is how that real spend gets reflected back into the credit wallet, and it
// also ratchets the cap down to the falling balance between funding events.

import type { InferSelectModel } from "drizzle-orm"
import { db, pool, instances, eq, and, isNotNull, sql } from "@/db"
import { getRuntimeKey, updateRuntimeKey } from "@/lib/openrouter-provisioning"
import { deductWithinTx, isAboveMinimum, getWalletCredits } from "@/lib/wallet"
import { maybeWarnLowBalance } from "@/lib/low-balance"
import {
  OPENROUTER_MARGIN,
  openRouterUsdToCredits,
  keyLimitUsdFromCredits,
} from "@/lib/credit-pricing"
import { pauseBot } from "@/lib/provisioner"
import { logInstanceEvent } from "@/lib/instance-state"
import { notify } from "@/lib/notifications/dispatch"
import { createAdminNotification } from "@/lib/admin-notify"

type Instance = InferSelectModel<typeof instances>

/** A single poll's worth of OpenRouter spend (USD) above this → treat as
 *  abuse (leaked token / runaway loop): enforce immediately + alert admin. */
const ANOMALY_USD_PER_INTERVAL = ((): number => {
  const raw = parseFloat(process.env.ANOMALY_USD_PER_INTERVAL ?? "")
  return Number.isFinite(raw) && raw > 0 ? raw : 50
})()

/** Don't PATCH the cap for sub-microdollar drift (matches the reconciler). */
const LIMIT_EPSILON = 1e-6

/** Round to micro-precision to avoid float noise on the wire. */
function roundUsd(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}

export type UsageSyncReport = {
  scanned: number
  /** Instances for which we deducted credits this run. */
  charged: number
  /** Total credits actually deducted this run. */
  creditsDeducted: number
  /** Instances we enforced against (key disabled + bot paused). */
  enforced: number
  errors: string[]
  /** True when a concurrent run already held the lock and this call did no work. */
  skipped?: boolean
}

/** Fleet-wide advisory-lock key serializing usage-sync runs ("ORUS" in hex). */
const USAGE_SYNC_LOCK_KEY = 0x4f_52_55_53

/**
 * Serialized entry point for the usage-sync cron. The endpoint fires on a timer
 * and a slow run (many instances × one OpenRouter network call each) can overlap
 * the next — the curl `--max-time` aborts the client, not this handler. Two
 * overlapping runs would read the same pointer and double-charge the wallet for
 * the same real usage. A fleet-wide Postgres advisory lock makes an overlapping
 * run a no-op (returns `skipped: true`). Uses a dedicated session client so the
 * lock is tied to a connection we control for the whole run.
 */
export async function runOpenRouterUsageSyncLocked(): Promise<UsageSyncReport> {
  const client = await pool.connect()
  let locked = false
  try {
    const res = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [USAGE_SYNC_LOCK_KEY],
    )
    locked = res.rows[0]?.ok === true
    if (!locked) {
      return {
        scanned: 0,
        charged: 0,
        creditsDeducted: 0,
        enforced: 0,
        errors: [],
        skipped: true,
      }
    }
    return await runOpenRouterUsageSync()
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [
          USAGE_SYNC_LOCK_KEY,
        ])
      } catch {
        // session ending / lock already released — harmless
      }
    }
    client.release()
  }
}

export async function runOpenRouterUsageSync(): Promise<UsageSyncReport> {
  const report: UsageSyncReport = {
    scanned: 0,
    charged: 0,
    creditsDeducted: 0,
    enforced: 0,
    errors: [],
  }

  // Users we charged this run — warned (once/day) about a low balance after the
  // loop, so a multi-instance user gets one nudge, not one per key.
  const chargedUsers = new Set<string>()

  // Without the provisioning key we can't read OpenRouter usage. Skip silently
  // so the route stays usable for fleets that haven't enabled per-instance keys.
  if (!process.env.OPENROUTER_PROVISIONING_KEY) return report

  const rows = await db.query.instances.findMany({
    where: and(
      isNotNull(instances.openRouterKeyId),
      sql`${instances.status} != 'deleted'`,
    ),
  })

  for (const row of rows) {
    // Skip BYOS own-key instances — they spend on the customer's own key and
    // never draw on our wallet.
    if (row.byosLlmMode === "own_key" || !row.openRouterKeyId) continue
    // Skip reseller agents whose key lives on a tenant's OpenRouter account — the
    // platform provisioning key can't read them and the tenant carries the cost.
    // `tenantKeyed` is stamped at mint time (getOrMintInstanceOpenRouterKey) and
    // correctly covers a tenant's own-team agents too, unlike the old child-only
    // JOIN which left those to 404 on every run.
    if (row.tenantKeyed) continue
    report.scanned++

    let state: Awaited<ReturnType<typeof getRuntimeKey>>
    try {
      state = await getRuntimeKey(row.openRouterKeyId)
    } catch (err) {
      report.errors.push(
        `get ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    const prev = row.openRouterUsageUsd ?? 0
    const delta = state.usageUsd - prev

    // Advance the pointer carefully so we never systematically lose sub-credit
    // usage to rounding, and never charge twice:
    //   - usage decreased (key reset / OR anomaly): resync down, don't charge.
    //   - delta rounds to < 1 credit: leave the pointer so the fraction
    //     accumulates until it crosses a whole credit.
    //   - otherwise: charge, and advance only by the exact USD those credits
    //     cover (delta = credits × margin / 100), keeping the remainder.
    //
    // CRITICAL: the charge and the pointer advance commit in the SAME
    // transaction. If they didn't, a crash between them would either re-charge
    // the delta next poll (pointer never advanced) or silently drop usage
    // (pointer advanced, charge rolled back). Atomic = exactly-once.
    if (delta <= 0) {
      if (state.usageUsd !== prev) {
        await db
          .update(instances)
          .set({ openRouterUsageUsd: state.usageUsd })
          .where(eq(instances.id, row.id))
      }
    } else {
      const credits = openRouterUsdToCredits(delta)
      if (credits > 0) {
        const charged = await db.transaction(async (tx) => {
          // Re-read the pointer under a row lock (SELECT … FOR UPDATE) and
          // recompute the delta INSIDE the tx. The advisory lock already
          // serializes runs; this makes exactly-once hold even if a future
          // caller bypasses the wrapper, so two txs can't both deduct a delta
          // computed from the same stale pointer. The snapshot `credits > 0`
          // above stays as a cheap pre-filter; this recompute is authoritative.
          const [fresh] = await tx
            .select({ usd: instances.openRouterUsageUsd })
            .from(instances)
            .where(eq(instances.id, row.id))
            .for("update")
          const freshPrev = fresh?.usd ?? 0
          const freshDelta = state.usageUsd - freshPrev
          const freshCredits = openRouterUsdToCredits(freshDelta)
          if (freshCredits <= 0) return 0
          const result = await deductWithinTx(
            tx,
            row.userId,
            freshCredits,
            "api_usage",
            row.id,
            `OpenRouter usage: $${freshDelta.toFixed(6)}`,
            { allowBelowMinimum: true },
          )
          const c = freshCredits - result.shortfall
          // USD these charged credits cover (inverse of the markup).
          const pointer = freshPrev + (c / 100) * OPENROUTER_MARGIN
          if (pointer !== freshPrev) {
            await tx
              .update(instances)
              .set({ openRouterUsageUsd: pointer })
              .where(eq(instances.id, row.id))
          }
          return c
        })
        // Only count instances we actually deducted from — the in-tx recompute
        // can return 0 (pointer already advanced by a concurrent run, or the
        // wallet was fully drained), which must not inflate `charged`.
        if (charged > 0) {
          report.charged++
          report.creditsDeducted += charged
          chargedUsers.add(row.userId)
        }
      }
      // credits === 0: sub-credit delta — leave the pointer so it accumulates.
    }

    // ── Enforcement ──────────────────────────────────────────────────────
    const capHit = state.limitUsd != null && state.usageUsd >= state.limitUsd
    const anomaly = delta > ANOMALY_USD_PER_INTERVAL
    const drained = !(await isAboveMinimum(row.userId))

    if (capHit || anomaly || drained) {
      const reason = anomaly
        ? `anomalous spend $${delta.toFixed(2)} in one interval`
        : capHit
          ? "OpenRouter spend cap reached"
          : "wallet balance below minimum"
      try {
        await enforce(row, state, reason, anomaly)
        report.enforced++
      } catch (err) {
        report.errors.push(
          `enforce ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      // ── Ratchet the cap to current spendable balance ─────────────────────
      // cap = this key's cumulative usage + the real-USD headroom the user's
      // CURRENT balance still buys. Funding-time sync only ever RAISES the cap;
      // this is what tightens it back DOWN as the balance falls (api_usage,
      // daily compute, plan-credit expiry) between funding events. Skip when we
      // just enforced (the key is disabled; no point re-capping it).
      try {
        const balance = await getWalletCredits(row.userId)
        const intended = roundUsd(state.usageUsd + keyLimitUsdFromCredits(balance))
        if (state.limitUsd == null || Math.abs(state.limitUsd - intended) > LIMIT_EPSILON) {
          await updateRuntimeKey(row.openRouterKeyId, { limit: intended })
          await db
            .update(instances)
            .set({ openRouterLimitUsd: intended })
            .where(eq(instances.id, row.id))
        }
      } catch (err) {
        report.errors.push(
          `cap ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // Proactive low-balance nudges for users we charged (self-gated to the
  // warning band + once/day; never throws into the sync result).
  for (const userId of chargedUsers) {
    try {
      await maybeWarnLowBalance(userId)
    } catch (err) {
      report.errors.push(
        `warn ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  console.log(JSON.stringify({ kind: "openrouter_usage_sync", ...report }))
  return report
}

/**
 * Hard-stop an abusing / drained instance: disable the OpenRouter key, pause
 * the bot, and notify the user + admin. Idempotent enough to re-run safely.
 */
async function enforce(
  instance: Instance,
  state: Awaited<ReturnType<typeof getRuntimeKey>>,
  reason: string,
  anomaly: boolean,
): Promise<void> {
  // 1. Disable the key (idempotent; skip if already disabled).
  if (!state.disabled && instance.openRouterKeyId) {
    await updateRuntimeKey(instance.openRouterKeyId, { disabled: true })
  }

  // 2. Pause the bot if it's running.
  if (instance.status === "running") {
    try {
      await pauseBot(instance)
    } catch (err) {
      console.warn(`[usage-sync] pauseBot failed for ${instance.id}:`, err)
    }
  }

  await logInstanceEvent({
    instanceId: instance.id,
    level: "warn",
    stage: "usage_sync",
    action: "enforce",
    result: "ok",
    detail: { reason, usageUsd: state.usageUsd, limitUsd: state.limitUsd },
    message: `OpenRouter key disabled and bot paused: ${reason}.`,
  })

  // 3. Notify the user.
  await notify({
    userId: instance.userId,
    category: "billing",
    type: "low_balance",
    title: `Agent "${instance.name}" paused`,
    message: anomaly
      ? `We paused "${instance.name}" after detecting unusually high AI usage (${reason}). Review activity, then top up to resume.`
      : `"${instance.name}" was paused because ${reason}. Add credits to resume.`,
    url: "/dashboard/billing",
    instanceId: instance.id,
  })

  // 4. Alert admin (anomalies are the interesting case — possible leaked token).
  await createAdminNotification({
    type: anomaly ? "instance_stopped" : "low_balance",
    userId: instance.userId,
    instanceId: instance.id,
    message: `Usage-sync enforced on "${instance.name}" (${reason}). Key disabled, bot paused. Current OpenRouter usage $${state.usageUsd.toFixed(2)}${
      state.limitUsd != null ? ` / cap $${state.limitUsd.toFixed(2)}` : ""
    }.`,
  })
}
