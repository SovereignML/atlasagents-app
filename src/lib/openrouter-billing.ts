// Margin-protected OpenRouter spend caps.
//
// Each per-instance OpenRouter runtime key is capped at
//   thisKeyUsageUsd + creditsToUsd(currentBalance) × margin
// i.e. whatever it has already spent PLUS the real-USD headroom the user's
// current wallet balance still buys. Because OpenRouter enforces cumulative
// `usage ≤ limit` server-side, this is a hard floor on our cost regardless of
// how the usage poller behaves. Deriving the cap from the CURRENT balance (not
// monotonic lifetime-funded) means it tightens automatically when the user
// spends, when plan credits expire, and — crucially — when a key is revoked
// and reprovisioned (the fresh key starts at usage 0, so its cap is exactly the
// remaining balance instead of the full lifetime ceiling). For a single
// long-lived key this equals the old `lifetimeFunded × margin` behavior
// (`usage + (funded − spent)×margin ≡ funded×margin`), so it's a tightening,
// not a regression.
//
// `fundWallet` is the funding entry point: deposit credits, then re-sync the
// caps (raising them and re-enabling any key we'd disabled for low balance).
// All funding call sites (Stripe top-up, plan renewal, admin grant, dev
// top-up) should route through it.

import { db, instances, eq, and, isNotNull, sql } from "@/db"
import {
  depositToWallet,
  depositPlanCredits,
  addPlanCredits,
  getWalletCredits,
  type WalletTransactionType,
} from "@/lib/wallet"
import { keyLimitUsdFromCredits } from "@/lib/credit-pricing"
import { updateRuntimeKey } from "@/lib/openrouter-provisioning"

/** Round to whole cents of micro-precision to avoid float noise on the wire. */
function roundUsd(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}

/**
 * The USD spend cap for one of a user's OpenRouter keys: the key's existing
 * cumulative usage plus the real-USD headroom their CURRENT balance buys.
 * `keyUsageUsd` defaults to 0 — the correct value for a freshly minted key
 * (reprovision), which then gets capped at exactly the remaining balance.
 */
export async function computeKeyLimitUsd(
  userId: string,
  keyUsageUsd = 0,
): Promise<number> {
  const balance = await getWalletCredits(userId)
  return roundUsd((keyUsageUsd ?? 0) + keyLimitUsdFromCredits(balance))
}

/**
 * The user's managed-credit instances that own a minted OpenRouter key.
 * Excludes deleted instances and BYOS "own_key" instances (those use the
 * customer's own key and never draw on our wallet).
 */
async function managedKeyInstances(userId: string) {
  const rows = await db.query.instances.findMany({
    where: and(
      eq(instances.userId, userId),
      isNotNull(instances.openRouterKeyId),
      sql`${instances.status} != 'deleted'`,
    ),
    columns: {
      id: true,
      openRouterKeyId: true,
      byosLlmMode: true,
      openRouterUsageUsd: true,
    },
  })
  return rows.filter((r) => r.byosLlmMode !== "own_key" && r.openRouterKeyId)
}

/**
 * Re-set the OpenRouter spend cap on all of a user's managed keys to their
 * current lifetime-funded cap, and re-enable any key we'd disabled for low
 * balance. Best-effort: PATCH failures are logged, not thrown — the
 * reconciler's drift pass self-heals anything we miss. Runs no DB
 * transaction; all network calls are outside any txn.
 */
export async function syncOpenRouterLimitsForUser(userId: string): Promise<void> {
  if (!process.env.OPENROUTER_PROVISIONING_KEY) return

  // Read the balance once; each key's cap = its own usage + that headroom.
  const balance = await getWalletCredits(userId)
  const headroomUsd = keyLimitUsdFromCredits(balance)
  const rows = await managedKeyInstances(userId)

  for (const row of rows) {
    const limitUsd = roundUsd((row.openRouterUsageUsd ?? 0) + headroomUsd)
    try {
      await updateRuntimeKey(row.openRouterKeyId!, { limit: limitUsd, disabled: false })
      await db
        .update(instances)
        .set({ openRouterLimitUsd: limitUsd })
        .where(eq(instances.id, row.id))
    } catch (err) {
      console.warn(
        `[openrouter-billing] sync cap failed for instance ${row.id} (key ${row.openRouterKeyId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
}

/**
 * Fund a user's wallet and re-sync their OpenRouter caps. The deposit is the
 * authoritative, transactional part; cap sync is best-effort (the deposit
 * succeeds even if OpenRouter is unreachable — the reconciler self-heals).
 * Returns the new credit balance.
 *
 * `plan_deposit` is routed through the use-it-or-lose-it bucket. `opts.planMode`
 * controls how it lands:
 *   "renew" (default) — expire the prior period's unspent plan credits, then add
 *     the new allotment (a subscription RENEWAL of the same plan).
 *   "add" — stack the allotment on the existing bucket without expiring it, and
 *     push expiry out to the later period end (a NEW subscription/instance, so
 *     credits genuinely increase). See {@link addPlanCredits}.
 * All other funding types are persistent.
 */
export async function fundWallet(
  userId: string,
  credits: number,
  type: WalletTransactionType,
  description?: string,
  instanceId?: string,
  opts: { planExpiry?: Date | null; planMode?: "renew" | "add" } = {},
): Promise<number> {
  const balance =
    type === "plan_deposit"
      ? opts.planMode === "add"
        ? await addPlanCredits(userId, credits, opts.planExpiry ?? null, description, instanceId)
        : await depositPlanCredits(userId, credits, opts.planExpiry ?? null, description, instanceId)
      : await depositToWallet(userId, credits, type, description, instanceId)
  try {
    await syncOpenRouterLimitsForUser(userId)
  } catch (err) {
    console.warn(
      `[openrouter-billing] fundWallet cap sync failed for user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return balance
}
