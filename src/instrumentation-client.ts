// Sentry browser-side init. Next.js loads this automatically on the client.
// No-ops cleanly when NEXT_PUBLIC_SENTRY_DSN is unset (dev/local).
import * as Sentry from "@sentry/nextjs"
import { SENTRY_DATA_COLLECTION } from "@/lib/sentry-data-collection"
import { scrubSentryEvent } from "@/lib/sentry-scrub"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // PII (IPs, user agents, user info, bodies) stays out of Sentry.
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
})

// Instruments App Router navigations for performance traces.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
