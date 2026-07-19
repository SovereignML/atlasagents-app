// Next.js runs register() once at server startup (per runtime).
// We use it to (1) init Sentry for the right runtime and (2) fail fast on
// broken production config — billing (billing-config) and platform-wide vars
// (env-check) — rather than discovering it per-request.

import * as Sentry from "@sentry/nextjs"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }

  // Only validate at actual server start (Node runtime), not during `next build`
  // — the build runs register() with NODE_ENV=production but may legitimately
  // lack runtime secrets, and we don't want to fail builds on that.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { assertBillingConfig } = await import("@/lib/billing-config")
    const { assertEnv } = await import("@/lib/env-check")
    assertBillingConfig()
    assertEnv()

    // Self-driving warm VM pool: start the in-process refill scheduler so the
    // pool (the primary managed-VPS delivery path) stays topped up with zero
    // external cron wiring. No-ops when the pool is disabled. Dynamic import
    // keeps DB code out of the edge bundle.
    const { startWarmPoolScheduler } = await import("@/lib/warm-pool")
    startWarmPoolScheduler()
  }
}

// Reports errors from nested React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError
