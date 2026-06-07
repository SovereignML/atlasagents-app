// Sentry server-side init. Loaded from src/instrumentation.ts at boot.
// No-ops cleanly when SENTRY_DSN is unset (dev/local).
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  // Keep performance sampling modest — errors are the priority.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // PII (IPs, cookies) stays out of Sentry by default.
  sendDefaultPii: false,
})
