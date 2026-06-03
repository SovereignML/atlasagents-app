// Next.js runs register() once at server startup (Node runtime only).
// We use it to fail fast on a broken production billing config rather than
// discovering it per-request.

export async function register() {
  // Only validate at actual server start (Node runtime), not during `next build`
  // — the build runs register() with NODE_ENV=production but may legitimately
  // lack runtime secrets, and we don't want to fail builds on that.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { assertBillingConfig } = await import("@/lib/billing-config")
    assertBillingConfig()
  }
}
