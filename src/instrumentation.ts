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
    //
    // NOT started under `next dev`. There is a single `.env` in this repo and it
    // holds production credentials, so a developer running `npm run dev` would
    // otherwise turn their laptop into a live pool controller: reaping real
    // Linodes, provisioning replacements and writing Cloudflare DNS. The
    // advisory lock in refillWarmPoolLocked() prevents a concurrent double
    // CREATE, but it does not stop a local process from doing the pool's real
    // work — it just serialises whoever gets there first.
    //
    // Set ENABLE_WARM_POOL_IN_DEV=1 to opt in deliberately (e.g. when actually
    // developing the pool against a scratch database). Production is unchanged:
    // `next start` / the standalone server run with NODE_ENV=production.
    const warmPoolEnabled =
      process.env.NODE_ENV === "production" ||
      process.env.ENABLE_WARM_POOL_IN_DEV === "1"

    if (warmPoolEnabled) {
      const { startWarmPoolScheduler } = await import("@/lib/warm-pool")
      startWarmPoolScheduler()
    } else {
      console.warn(
        "[instrumentation] warm-pool scheduler NOT started (dev). " +
          "Set ENABLE_WARM_POOL_IN_DEV=1 to enable.",
      )
    }
  }
}

// Reports errors from nested React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError
