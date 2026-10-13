// Sentry server-side init. Loaded from src/instrumentation.ts at boot.
// No-ops cleanly when SENTRY_DSN is unset (dev/local).
import * as Sentry from "@sentry/nextjs"
import { SENTRY_DATA_COLLECTION } from "./src/lib/sentry-data-collection"
import { scrubSentryEvent } from "./src/lib/sentry-scrub"

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  // Keep performance sampling modest — errors are the priority.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // PII (IPs, cookies, user info, bodies) stays out of Sentry.
  dataCollection: SENTRY_DATA_COLLECTION,
  // Most server errors are caught and logged with console.error (apiError,
  // cron and job catch blocks) rather than thrown, so they never reached
  // Sentry. Capture those logs as events; an Error argument becomes the
  // exception.
  integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  // Tokens, keys and emails out of messages, console arguments and URLs.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
})
