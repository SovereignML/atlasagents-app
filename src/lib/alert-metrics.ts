// Pure, dependency-free alert metric helpers. Kept separate from alerts.ts so
// the comparator logic is unit-testable without pulling in the db client (which
// throws at import without DATABASE_URL).

/** True when `value` breaches the threshold under the given comparator. */
export function compare(value: number, comparator: string, threshold: number): boolean {
  return comparator === "gt" ? value > threshold : value < threshold
}

/**
 * Event types that count toward the error rate. A run or tool call is one unit
 * of work, failed when its `status` is "error"; a standalone `error` event (how
 * the platform's event model reports failures, see scripts/seed-agent-events.ts)
 * is a failed unit on its own.
 */
export const ERROR_RATE_EVENT_TYPES = ["run.finished", "tool.called", "error"] as const

/**
 * Failed units over all units, in [0, 1], or null with no events. Clamped,
 * since an agent may emit both a failed run.finished and an error event for
 * the same failure.
 */
export function errorRate(counts: { total: number; failed: number }): number | null {
  if (counts.total <= 0) return null
  return Math.min(1, Math.max(0, counts.failed / counts.total))
}
