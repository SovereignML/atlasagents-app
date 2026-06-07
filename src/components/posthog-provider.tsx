"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import { useEffect, type ReactNode } from "react"
import { PostHogIdentify } from "@/components/posthog-identify"
import { PostHogPageview } from "@/components/posthog-pageview"

// Client-side PostHog (analytics, session replay, feature flags). Same
// contract as Sentry (src/instrumentation-client.ts): a hard no-op when
// NEXT_PUBLIC_POSTHOG_KEY is unset — children render straight through with
// zero overhead. Browser traffic goes through the /ingest reverse proxy
// (next.config.ts rewrites) so ad-blockers don't drop events.
// See docs/POSTHOG.md.

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ingest"

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!KEY || posthog.__loaded) return
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: "https://us.posthog.com", // keeps "view in PostHog" toolbar links working
      capture_pageview: false, // captured manually — see posthog-pageview.tsx
      capture_pageleave: true,
      autocapture: true,
      person_profiles: "identified_only",
      // Privacy: mirror Sentry's sendDefaultPii:false ethos. Replay must also
      // be enabled in the PostHog project settings to actually record.
      session_recording: { maskAllInputs: true },
    })
  }, [])

  if (!KEY) return <>{children}</>

  return (
    <PHProvider client={posthog}>
      <PostHogPageview />
      <PostHogIdentify />
      {children}
    </PHProvider>
  )
}
