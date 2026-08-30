# Atlas Agents — PostHog product analytics

This document covers the **PostHog** integration: what it captures, the files involved, environment variables, production setup, and how to verify it works.

PostHog is **optional and off by default** — with no key configured, the client provider renders children straight through, the server helper no-ops, and the app behaves exactly as before. There is no code path that requires PostHog to be configured.

For the rest of the env reference, see [.env.example](../.env.example). For error monitoring, see [SENTRY.md](SENTRY.md).

---

## 1. At a glance

| Concern | Choice |
|---|---|
| SDKs | `posthog-js` (browser), `posthog-node` (server) |
| Enabled when | `NEXT_PUBLIC_POSTHOG_KEY` is set — otherwise fully disabled |
| Region | PostHog **US cloud** (`us.i.posthog.com`) |
| Ingestion path | Browser events proxied through the app at `/ingest` (Next rewrites) so ad-blockers don't drop them; server SDK talks direct |
| Pageviews | Captured manually on App Router navigations (`capture_pageview: false` + tracker component) |
| Identity | `posthog.identify(user.id)` on sign-in (email, name, role); `reset()` on sign-out; `person_profiles: "identified_only"` |
| Session replay | Enabled in code with **all inputs masked** — must *also* be turned on in the PostHog project settings to record |
| Feature flags | Client hooks (`posthog-js/react`) + server helper (`posthogServer`) |
| PII | Minimal by design — only the identify fields above; inputs masked in replay (mirrors Sentry's `sendDefaultPii: false` ethos) |

## 2. Files involved

| File | Runtime | Purpose |
|---|---|---|
| `src/components/posthog-provider.tsx` | Browser | `posthog.init` + `PostHogProvider` context; hard no-op without the key |
| `src/components/posthog-pageview.tsx` | Browser | Manual `$pageview` capture on `usePathname`/`useSearchParams` changes (Suspense-wrapped) |
| `src/components/posthog-identify.tsx` | Browser | `identify` on auth, `reset` on sign-out, driven by `useSession()` |
| `src/components/app-providers.tsx` | Browser | Mounts `PostHogProvider` inside `SessionProvider` |
| `src/lib/posthog-server.ts` | Node server | Singleton `posthog-node` client: `capture`, `isFeatureEnabled`, `getAllFlags`; no-op stub without a key |
| `next.config.ts` | Build/serve | `/ingest` reverse-proxy rewrites + `skipTrailingSlashRedirect: true` |
| `src/lib/env-check.ts` | Server boot | Warning (never an error) when unset/half-configured in prod |

### How an event reaches PostHog

- **Pageview / autocapture / custom client event** → browser → `https://your-domain/ingest/...` → Next rewrite → `us.i.posthog.com`. SDK assets load via `/ingest/static/...` → `us-assets.i.posthog.com`.
- **Server event** (`posthogServer.capture`) → batched in-process (`flushAt: 20`, `flushInterval: 10s`) → direct to `us.i.posthog.com`. Fire-and-forget; never blocks or fails the request.
- **Identity**: sign-in → `PostHogIdentify` calls `identify(user.id, { email, name, role })` once per distinct-id change; sign-out redirects to `/` and the post-redirect render calls `reset()`.

Current server events: `user_signed_up` (credentials registration, `src/app/api/auth/register/route.ts`) and `subscription_changed` with `action: created | updated | canceled` (Stripe webhook handlers, `src/lib/stripe-events.ts`).

## 3. Environment variables

All documented in `.env.example` under *"PostHog product analytics"*.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | to enable anything client-side | The `phc_…` project API key. **Inlined at build time** — must be present when `next build` runs, not just at boot (same gotcha as the Sentry DSN) |
| `NEXT_PUBLIC_POSTHOG_HOST` | no (default `/ingest`) | The browser `api_host`. Leave as the proxy path; only change if self-hosting PostHog |
| `POSTHOG_KEY` | no | Server SDK key; falls back to `NEXT_PUBLIC_POSTHOG_KEY` (the same `phc_…` key is normal) |
| `POSTHOG_HOST` | no (default `https://us.i.posthog.com`) | Server SDK host — direct, not proxied |

The `phc_…` project key is **not a secret** (it can only ingest events and read flags, not query data) — safe to inline in the client bundle.

## 4. Production setup

1. Create a project at [us.posthog.com](https://us.posthog.com) → copy the project API key (`phc_…`).
2. Set in the production **and build** environment:
   ```bash
   NEXT_PUBLIC_POSTHOG_KEY="phc_…"
   NEXT_PUBLIC_POSTHOG_HOST="/ingest"
   POSTHOG_HOST="https://us.i.posthog.com"
   ```
3. In the PostHog project settings, enable **Session replay** (the code config only takes effect once the project-level toggle is on).
4. Rebuild and deploy — the key only takes effect client-side after a rebuild (build-time inlining).

The `/ingest` path is host-relative, so it works unchanged on white-label custom domains — tenant traffic proxies through whatever domain served the page.

## 5. Verifying it works

After deploying (or `npm run dev`) with a key set:

- **Network tab**: requests to `/ingest/...` return 200; the SDK bundle loads from `/ingest/static/...`. Nothing should hit `*.posthog.com` directly from the browser.
- **Pageviews**: navigate between routes client-side — exactly one `$pageview` per navigation in PostHog's activity view.
- **Identify**: sign in → the person appears in PostHog with your user id, email, name, role. Sign out → subsequent events are anonymous.
- **Server events**: register a new account → `user_signed_up` appears under that user id. A Stripe subscription event → `subscription_changed`.
- **Replay**: with the project-level toggle on, a recording appears; confirm inputs render masked.
- **Flags**: create a flag in PostHog, gate something with `useFeatureFlagEnabled("flag-key")`, toggle it, confirm the UI follows.

With **no key** (`npm run dev`, sparse `.env`) you should see **no** `/ingest` network activity and no console errors — the provider renders children directly and never calls `posthog.init`.

## 6. Defaults and how to change them

| Default | Where | Why / when to change |
|---|---|---|
| `capture_pageview: false` + manual tracker | `posthog-provider.tsx` / `posthog-pageview.tsx` | App Router client navigations need manual capture; don't re-enable auto-capture or you'll double-count |
| `person_profiles: "identified_only"` | `posthog-provider.tsx` | Anonymous visitors don't create person profiles (cheaper, less PII). Switch to `"always"` for full anonymous-visitor profiles |
| `session_recording: { maskAllInputs: true }` | `posthog-provider.tsx` | Privacy default. For stricter masking add `maskTextSelector: "*"` (masks all text, dashboards get less useful) |
| `autocapture: true` | `posthog-provider.tsx` | Clicks/inputs auto-tracked. Disable if event volume becomes noisy |
| `flushAt: 20`, `flushInterval: 10_000` | `posthog-server.ts` | Server batch tuning; fine for a long-running standalone server |
| `ui_host: "https://us.posthog.com"` | `posthog-provider.tsx` | Keeps "view in PostHog" toolbar links working behind the proxy |

## 7. Feature flags

**Client** (`posthog-js/react`):

```tsx
import { useFeatureFlagEnabled } from "posthog-js/react"

const showNewNav = useFeatureFlagEnabled("new-nav") // undefined until loaded / when disabled
if (showNewNav) { /* ... */ }
```

Treat `undefined` as off — that's also what you get when PostHog is disabled entirely.

**Server** (`src/lib/posthog-server.ts`):

```ts
import { posthogServer } from "@/lib/posthog-server"

const enabled = await posthogServer.isFeatureEnabled("new-nav", userId) // undefined when disabled
const flags = await posthogServer.getAllFlags(userId)                   // {} when disabled
```

## 8. Teams / group analytics (follow-up)

The session only carries `user.id` and `role` — there is no client-side "active team" context yet, so client group analytics is deferred. When one exists, call `posthog.group("team", teamId, { name })` after identify. Server-side, `posthogServer.capture` already accepts `groups: { team: teamId }` wherever a team id is in scope.

## 9. Interaction with the rest of the stack

- **Sentry** coexists untouched — separate SDKs, separate env vars; `withSentryConfig` preserves the `rewrites()` PostHog needs.
- **next-auth** is the single source of identity — `PostHogIdentify` sits inside `SessionProvider` and follows session state; no separate auth wiring.
- **Boot-time env validation** (`src/lib/env-check.ts`) only *warns* when PostHog is unset — analytics never blocks a production boot.
- **CI** builds without any PostHog vars — everything no-ops, no secrets needed.
- **Standalone output**: rewrites run inside the Next server, so the `/ingest` proxy works in `output: "standalone"` with no extra infra. `skipTrailingSlashRedirect: true` was added so proxied PostHog paths aren't redirected; app routes are unaffected (Next still normalizes its own routes).
