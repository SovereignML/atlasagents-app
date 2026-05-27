// Margin-protected OpenRouter spend caps.
//
// Each per-instance OpenRouter runtime key is capped at the USD a user has
// funded times the margin (`keyLimitUsdFromCredits`). The cap is cumulative —
// it tracks LIFETIME funded credits, matching OpenRouter's cumulative
// `usage`/`limit` semantics — so it's only ever raised, on every funding
// event. This guarantees OpenRouter can never bill us more than the margin
// fraction of revenue, regardless of how the usage poller behaves.
//
// `fundWallet` is the funding entry point: deposit credits, then re-sync the
// caps (raising them and re-enabling any key we'd disabled for low balance).
// All funding call sites (Stripe top-up, plan renewal, admin grant, dev
// top-up) should route through it.

import { db, instances, eq, and, isNotNull, sql } from "@/db"
import { depositToWallet, getLifetimeFundedCredits, type WalletTransactionType } from "@/lib/wallet"
import { keyLimitUsdFromCredits } from "@/lib/credit-pricing"
import { updateRuntimeKey } from "@/lib/openrouter-provisioning"

/** Round to whole cents of micro-precision to avoid float noise on the wire. */
function roundUsd(usd: number): number {
  return Math.round(usd * 1e6) / 1e6
}

/**
 * The USD spend cap for a user's OpenRouter key(s), from their lifetime
 * funded credits. Cumulative — never lowered.
 */
export async function computeKeyLimitUsd(userId: string): Promise<number> {
  const funded = await getLifetimeFundedCredits(userId)
  return roundUsd(keyLimitUsdFromCredits(funded))
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
    columns: { id: true, openRouterKeyId: true, byosLlmMode: true },
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

  const limitUsd = await computeKeyLimitUsd(userId)
  const rows = await managedKeyInstances(userId)

  for (const row of rows) {
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
 */
export async function fundWallet(
  userId: string,
  credits: number,
  type: WalletTransactionType,
  description?: string,
  instanceId?: string,
): Promise<number> {
  const balance = await depositToWallet(userId, credits, type, description, instanceId)
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
