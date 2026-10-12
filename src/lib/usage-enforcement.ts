// When the OpenRouter usage poller (src/lib/openrouter-usage.ts) hard-stops an
// agent: disables its key and pauses it. Pure, so it can be unit-tested without
// a database or OpenRouter.

/** A single poll's worth of OpenRouter spend (USD) above this → treat as
 *  abuse (leaked token / runaway loop): enforce immediately + alert admin. */
export const ANOMALY_USD_PER_INTERVAL = ((): number => {
  const raw = parseFloat(process.env.ANOMALY_USD_PER_INTERVAL ?? "")
  return Number.isFinite(raw) && raw > 0 ? raw : 50
})()

export type EnforcementInput = {
  /** The key's cumulative real spend (USD). */
  usageUsd: number
  /** The key's spend cap (USD), or null when it has none. */
  limitUsd: number | null
  /** Spend since the previous poll (USD). */
  deltaUsd: number
  /** The owner's wallet is at or above its minimum balance. */
  aboveMinimum: boolean
  /** A Free-tier demo agent (non-null `instances.expiresAt`). */
  demo: boolean
}

export type Enforcement = { reason: string; anomaly: boolean }

/**
 * Why to hard-stop this agent, or null to leave it running (the poller then
 * ratchets its cap instead).
 *
 * The wallet-floor check does not apply to Free-tier demos. A Free deploy
 * grants 10 credits against the 200-credit floor (DEFAULT_MIN_CREDITS), so the
 * check failed on the demo's first poll, before any usage: its key was
 * disabled within a minute of being minted and the agent paused as soon as it
 * came up. A demo's spend is bounded by its key cap, which is sized from the
 * same balance, and by its 30-minute lifetime.
 */
export function decideEnforcement(input: EnforcementInput): Enforcement | null {
  const capHit = input.limitUsd != null && input.usageUsd >= input.limitUsd
  const anomaly = input.deltaUsd > ANOMALY_USD_PER_INTERVAL
  const drained = !input.demo && !input.aboveMinimum
  if (!capHit && !anomaly && !drained) return null

  const reason = anomaly
    ? `anomalous spend $${input.deltaUsd.toFixed(2)} in one interval`
    : capHit
      ? "OpenRouter spend cap reached"
      : "wallet balance below minimum"
  return { reason, anomaly }
}
