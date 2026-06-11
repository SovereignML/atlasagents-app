// Pure, dependency-free alert metric helpers. Kept separate from alerts.ts so
// the comparator logic is unit-testable without pulling in the db client (which
// throws at import without DATABASE_URL).

/** True when `value` breaches the threshold under the given comparator. */
export function compare(value: number, comparator: string, threshold: number): boolean {
  return comparator === "gt" ? value > threshold : value < threshold
}
