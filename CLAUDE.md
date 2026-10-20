# CLAUDE.md

Guidance for AI agents working in this repo. Terse by design — follow the
`docs/` links for depth. Update this file when a decided tradeoff below
changes (a stale hard rule is worse than none).

## What this is

Atlas Agents: a production SaaS for deploying and operating AI agents on
managed VPSes (with billing, teams, and white-label reseller support). See
[`docs/FEATURES.md`](docs/FEATURES.md).

Stack: Next.js 16 (App Router) + React 19, Drizzle ORM + PostgreSQL,
NextAuth v5, Stripe + Stripe Connect, Tailwind v4 / shadcn. Source of truth:
[`docs/TECH-STACK.md`](docs/TECH-STACK.md).

## Commands

- `npm run dev` — dev server (kills port 3000 first)
- `npm run build` — production build
- `npm run test` — unit tests (`vitest run`)
- `npm run lint` — ESLint
- `npx tsc --noEmit` — typecheck (CI runs this; there is no `typecheck` script)
- `npm run db:push` — sync schema to the DB (see Hard rules)

CI (`.github/workflows/ci.yml`) runs lint, `npx tsc --noEmit`, test, integration
tests, build, and `npm audit --omit=dev --audit-level=critical`.

## Hard rules

- **Never** run `db:generate` / `db:migrate` against a real DB. Schema is
  synced with `drizzle-kit push` (`npm run db:push`); the deploy entrypoint
  runs `push --force` non-fatally, after `scripts/schema-guard.ts` confirms it
  would drop no table or column (otherwise it skips the push). There is no
  populated migrations journal, so `migrate` would fail on existing columns.
  ([`scripts/deploy-entrypoint.sh`](scripts/deploy-entrypoint.sh) L13-17,
  [`docs/TECH-STACK.md`](docs/TECH-STACK.md) §Database)
- `src/db/schema.ts` is the **only** maintained schema definition. If a
  `prisma/` folder appears, it is not used — ignore/remove it.
  ([`docs/TECH-STACK.md`](docs/TECH-STACK.md) L32, L67-70)
- Do **not** delete the multi-provider VPS router as "dead code."
  `src/lib/vps-router/` and the Linode provider are deliberate — the router
  ranks/fails over across providers by design (DigitalOcean is the primary
  active provider; Linode is retained for future use).
  ([`docs/PROVIDERS.md`](docs/PROVIDERS.md))
- Caddy is **not** fully legacy. Cloudflare for SaaS
  ([`src/lib/cloudflare-saas.ts`](src/lib/cloudflare-saas.ts) L1-2) replaced
  Caddy's on-demand TLS **only** for white-label tenant dashboard custom
  domains. Provisioned agent VPS boxes still render a `Caddyfile` per runtime,
  and the canonical dashboard host may sit behind Caddy — do not delete
  `deploy/` Caddy files. ([`deploy/README.md`](deploy/README.md) §7-§10)
- Tests are **unit-only**: pure logic, no DB, no network. Match
  `src/**/*.test.ts`. ([`vitest.config.ts`](vitest.config.ts) L4-5)
- Never commit secrets. Copy `.env.example` → `.env`; runtime loads `.env`
  only. Secrets live in env, never in the DB. ([`README.md`](README.md))

## Architecture orientation

- **DB**: singleton `pg.Pool` → `drizzle(pool, { schema })` in
  `src/db/index.ts`; tables in `src/db/schema.ts`.
- **Three UI surfaces, distinct auth scopes** — keep them separate:
  - `src/app/admin` — platform staff (`role === "admin"`)
  - `src/app/tenant-admin` — reseller / white-label tenant admin
  - `src/app/dashboard` — end users
- **Auth guards** — new routes/pages must use these helpers, not hand-rolled
  session checks:
  - `src/lib/admin-guard.ts` — `requireAdmin()` (route) / `requireAdminPage()`
  - `src/lib/tenant-admin-access.ts` — `requireTenantAdmin()` (white-label is
    enterprise-only; no layout gate — call per route/page)
  - `src/lib/instance-access.ts` — per-agent ACL (viewer/operator/manager)
  - `src/lib/effective-user.ts` — honored impersonation (`getHonoredImpersonatedUserId`)
  - `src/lib/team.ts` — team membership / management
- **Runtimes**: six agent engines — OpenClaw (default), Hermes, and the beta
  Claude Code, Codex, OpenCode and Pi (flag `CLI_RUNTIMES_ENABLED`; admins always) — behind
  `src/lib/runtimes/`. Import `getRuntime` from `@/lib/runtimes`; branch on
  `runtimeCaps(id)` / `engine.caps`, never on `runtime === "hermes"`.
  ([`docs/RUNTIMES.md`](docs/RUNTIMES.md))
- **API errors**: return `apiError(tag, err)` from `src/lib/api-error.ts` for
  500s (logs with a grep-able tag, returns structured JSON).
- **Idempotency**: use `src/lib/idempotency.ts` claim-with-release (NOT
  claim-on-success). Webhooks/billing crons claim in-transaction where money
  moves; release on error so upstream can retry.

## Docs index

- [`docs/FEATURES.md`](docs/FEATURES.md) — product surface / feature map
- [`docs/TECH-STACK.md`](docs/TECH-STACK.md) — stack + DB conventions (source of truth)
- [`docs/PROVIDERS.md`](docs/PROVIDERS.md) — VPS provider router
- [`docs/RUNTIMES.md`](docs/RUNTIMES.md) — OpenClaw / Hermes / Claude Code / Codex runtimes
- [`docs/BILLING.md`](docs/BILLING.md), [`docs/BILLING-HARDENING.md`](docs/BILLING-HARDENING.md) — credits, Stripe, idempotency
- [`docs/BYOS.md`](docs/BYOS.md) — bring-your-own-server
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — Google Drive / Cloudflare
- [`docs/DEVELOPER-GUIDE.md`](docs/DEVELOPER-GUIDE.md) — dev workflow
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploy / ops
