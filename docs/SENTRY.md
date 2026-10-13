# Atlas Agents — Sentry error monitoring

This document covers the **Sentry** integration: what it captures, the files involved, environment variables, production setup, and how to verify it works.

Sentry is **optional and off by default** — with no DSN configured, every init is a no-op and the app behaves exactly as before. There is no code path that requires Sentry to be configured.

For the rest of the env reference, see [.env.example](../.env.example). For deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 1. At a glance

| Concern | Choice |
|---|---|
| SDK | `@sentry/nextjs` v11 |
| Enabled when | a DSN env var is set (see §3) — otherwise fully disabled |
| PII | **Off**: `dataCollection: SENTRY_DATA_COLLECTION` (`src/lib/sentry-data-collection.ts`) sends no user info, cookies, bodies, local variables, or IP/user headers |
| Performance traces | 10% sampling by default (`SENTRY_TRACES_SAMPLE_RATE`) |
| Source maps | Uploaded at build time **only** when `SENTRY_AUTH_TOKEN` + org/project are set |
| Session replay | Not enabled |

## 2. Files involved

| File | Runtime | Purpose |
|---|---|---|
| `sentry.server.config.ts` | Node server | `Sentry.init` for API routes, RSC, server actions |
| `sentry.edge.config.ts` | Edge (proxy/middleware) | `Sentry.init` for the edge runtime |
| `src/instrumentation.ts` | Server boot | Loads the right config per runtime; exports `onRequestError` (captures errors from nested RSC + route handlers) |
| `src/instrumentation-client.ts` | Browser | Client-side `Sentry.init`; exports `onRouterTransitionStart` for navigation traces |
| `src/app/global-error.tsx` | Browser | Last-resort error boundary — renders when the **root layout** crashes; reports via `Sentry.captureException`. Self-contained (own `<html>/<body>`, inline styles, no theme/font deps) because the root layout is gone when it renders |
| `next.config.ts` | Build | `withSentryConfig(...)` wrapper from `@sentry/nextjs/config` — bundle instrumentation + conditional source-map upload |

### How an error reaches Sentry

- **Server route / RSC / server action throws** → `onRequestError` in `src/instrumentation.ts`
- **Server code catches the error and logs it with `console.error`** (`apiError`, cron and job catch blocks — most server errors) → `captureConsoleIntegration` in `sentry.server.config.ts`. An `Error` argument becomes the exception; the other arguments are attached, scrubbed, as `extra.arguments`. `apiError` logs a short `ref` that is also in the 500 body the client sees, so a user's report can be matched to the event
- **Client component throws below the root layout** → Next's route error boundary; Sentry's client SDK captures the unhandled error automatically
- **Root layout itself crashes** → `src/app/global-error.tsx` (explicit `captureException`)
- **Unhandled promise rejection (browser)** → client SDK global handlers

## 3. Environment variables

All documented in `.env.example` under *"Sentry error monitoring"*.

| Variable | Required | Notes |
|---|---|---|
| `SENTRY_DSN` | to enable server-side | Server-only; not exposed to the browser |
| `NEXT_PUBLIC_SENTRY_DSN` | to enable browser + edge | **Inlined at build time** — must be present when `next build` runs, not just at boot. The edge runtime also uses this one (only `NEXT_PUBLIC_*` vars are inlined into the edge bundle) |
| `SENTRY_TRACES_SAMPLE_RATE` | no (default `0.1`) | `0` disables performance traces entirely; errors are still captured |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | no (default `0.1`) | Browser-side sampling |
| `SENTRY_RELEASE` | no | Release name for events and source maps. Defaults to the 12-character commit SHA of the build (`git rev-parse` in `next.config.ts`), inlined as `NEXT_PUBLIC_SENTRY_RELEASE` so all three runtimes report the same release |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | no | Build-time only, for source-map upload. Omit in dev/CI — the build wrapper no-ops without them |

DSNs are **not secrets** in the traditional sense (they can only ingest events, not read data), but keep `SENTRY_AUTH_TOKEN` out of runtime env — it's a write-capable API token and is only needed by the build.

Both DSNs normally point at the **same Sentry project**; two vars exist only because of the server/browser inlining split. Setting just one is valid (e.g. server-only monitoring with `SENTRY_DSN`).

## 4. Production setup

1. Create a project at [sentry.io](https://sentry.io) → platform **Next.js**. Copy the DSN.
2. Set in the production environment:
   ```bash
   SENTRY_DSN="https://…@…ingest.sentry.io/…"
   NEXT_PUBLIC_SENTRY_DSN="https://…@…ingest.sentry.io/…"   # same DSN is fine
   ```
3. *(Recommended)* For readable stack traces, set the build-time vars wherever `next build` runs:
   ```bash
   SENTRY_ORG="your-org"
   SENTRY_PROJECT="sovereignml"
   SENTRY_AUTH_TOKEN="sntrys_…"   # org token with project:releases scope
   ```
4. Rebuild and deploy. `NEXT_PUBLIC_SENTRY_DSN` only takes effect for browser/edge after a rebuild (build-time inlining); `SENTRY_DSN` takes effect on next boot.

### Alerting

Configure alert rules in the Sentry UI (Slack/email on new issue, regression, spike). Nothing in the repo manages alert rules.

## 5. Verifying it works

After deploying with a DSN:

```bash
# Server-side: hit an API route that throws — or temporarily add one:
# src/app/api/sentry-test/route.ts  →  export function GET() { throw new Error("sentry server test") }
curl https://your-domain/api/sentry-test
```

- The event should appear in the Sentry project within seconds (environment tag = `production`).
- For the client side: throw from a `"use client"` component (e.g. a temporary `<button onClick={() => { throw new Error("sentry client test") }}>`) and check the event arrives with a readable stack trace (confirms source maps).
- Delete any test routes/buttons afterwards.

In dev (`npm run dev` with no DSN) you should see **no** Sentry network activity — the SDK is disabled, not just quiet.

## 6. Defaults and how to change them

| Default | Where | Why / when to change |
|---|---|---|
| `dataCollection: SENTRY_DATA_COLLECTION` | all three init files | Privacy-by-default. v11 removed `sendDefaultPii`, and an unset `dataCollection` collects everything; the shared constant is Sentry's documented equivalent of v10's `sendDefaultPii: false`, plus no local variables in stack frames. If you later want user context on errors, prefer explicit `Sentry.setUser({ id })` (no email) at session start rather than loosening this |
| `beforeSend: scrubSentryEvent` | all three init files | Redacts bearer values, provider keys (Stripe, OpenRouter, GitHub, Resend, Slack), Telegram bot tokens, JWTs, secret-looking query parameters, emails and long hex tokens from messages, exception values, console arguments, breadcrumbs and URLs (`src/lib/sentry-scrub.ts`). Add a pattern there when a new credential shape appears |
| `captureConsoleIntegration({ levels: ["error"] })` | `sentry.server.config.ts` | Turns every server `console.error` into an event. Use `console.warn` for expected failures that shouldn't page anyone |
| `tracesSampleRate: 0.1` | all three init files | Raise for more performance visibility, at quota cost. Errors are always captured regardless |
| `widenClientFileUpload: false` | `next.config.ts` | Keeps upload scope lean; widen if client traces come through unsymbolicated |
| `webpack.treeshake.removeDebugLogging: true` | `next.config.ts` | Strips Sentry's debug logger from webpack production bundles (v10's `disableLogger`); Turbopack builds ignore it |

## 7. Interaction with the rest of the stack

- **Boot-time env validation** (`src/instrumentation.ts` → `billing-config` + `env-check`) runs *after* Sentry server init, so a production boot refusal is itself reported if a DSN is set.
- **CI** (`.github/workflows/ci.yml`) builds without any Sentry vars — the wrapper and inits all no-op, so CI needs no Sentry secrets.
- **Standalone output**: `output: "standalone"` is unaffected; Sentry's runtime code ships inside the server bundle.
- **Turbopack**: builds use Next 16 + Turbopack; `withSentryConfig` v11 supports this. If a future SDK/Next upgrade breaks the build, the wrapper in `next.config.ts` is the first thing to bisect.
