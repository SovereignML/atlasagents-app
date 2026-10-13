// Sentry edge-runtime init (middleware). Loaded from src/instrumentation.ts.
// Only NEXT_PUBLIC_* vars are inlined into the edge bundle, so the DSN must be
// the public one here.
import * as Sentry from "@sentry/nextjs"
import { SENTRY_DATA_COLLECTION } from "./src/lib/sentry-data-collection"
import { scrubSentryEvent } from "./src/lib/sentry-scrub"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
})
