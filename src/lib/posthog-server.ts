// Server-side PostHog client (product analytics + feature flags), following
// the Sentry "no-op without env" pattern: when no key is configured every
// method is a safe no-op, so call sites never need to branch on whether
// analytics is enabled. See docs/POSTHOG.md.
//
// The app runs as a long-lived standalone server (next.config.ts
// `output: "standalone"`), so a lazily-created singleton with the SDK's
// periodic flush is correct — no per-request shutdown() needed. The server
// SDK talks directly to the PostHog host (the /ingest browser proxy exists
// only to dodge ad-blockers, which don't apply server-side).

import { PostHog } from "posthog-node"

const KEY = (process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY)?.trim()
const HOST = process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com"

type CaptureArgs = {
  /** Stable user identity — use the next-auth user id. */
  distinctId: string
  event: string
  properties?: Record<string, unknown>
  /** Group analytics, e.g. { team: teamId }. */
  groups?: Record<string, string>
}

let client: PostHog | null = null

function getClient(): PostHog | null {
  if (!KEY) return null
  if (!client) {
    client = new PostHog(KEY, {
      host: HOST,
      flushAt: 20, // batch size before an immediate flush
      flushInterval: 10_000, // ms — periodic flush for a long-running server
    })
  }
  return client
}

export const posthogServer = {
  /** True when a PostHog key is configured. Rarely needed — methods no-op anyway. */
  enabled: !!KEY,

  /** Fire-and-forget event capture; queued and flushed in batches. */
  capture(args: CaptureArgs): void {
    getClient()?.capture(args)
  },

  /** Server-side feature flag check. Returns undefined when PostHog is disabled. */
  async isFeatureEnabled(
    flag: string,
    distinctId: string,
    groups?: Record<string, string>,
  ): Promise<boolean | undefined> {
    return getClient()?.isFeatureEnabled(flag, distinctId, { groups })
  },

  /** All flags for a user. Returns {} when PostHog is disabled. */
  async getAllFlags(
    distinctId: string,
    groups?: Record<string, string>,
  ): Promise<Record<string, string | boolean>> {
    return (await getClient()?.getAllFlags(distinctId, { groups })) ?? {}
  },

  /** Flush + close. Only needed from a graceful-shutdown (SIGTERM) hook. */
  async shutdown(): Promise<void> {
    await client?.shutdown()
  },
}
