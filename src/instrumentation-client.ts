// Sentry browser-side init. Next.js loads this automatically on the client.
// No-ops cleanly when NEXT_PUBLIC_SENTRY_DSN is unset (dev/local).
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // PII (IPs, user agents) stays out of Sentry by default.
  sendDefaultPii: false,
})

// Instruments App Router navigations for performance traces.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
