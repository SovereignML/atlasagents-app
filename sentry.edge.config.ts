// Sentry edge-runtime init (middleware). Loaded from src/instrumentation.ts.
// Only NEXT_PUBLIC_* vars are inlined into the edge bundle, so the DSN must be
// the public one here.
import * as Sentry from "@sentry/nextjs"
import { SENTRY_DATA_COLLECTION } from "./src/lib/sentry-data-collection"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  dataCollection: SENTRY_DATA_COLLECTION,
})
