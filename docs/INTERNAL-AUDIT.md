# SovereignML — Internal Product & Engineering Audit

**Author:** Staff-engineering audit, written against the codebase as of 2026-04-17.
**Scope:** Next.js control plane (`/src`), bot runtime (`/bot-runtime`), Prisma schema, provisioner + SSH orchestration, Stripe + credits, gateway routing.
**Purpose:** Ground-truth assessment. Not a press release. Written for the founder/operator who will own failures.

---

## 1. Product Vision (What This Is Becoming)

### What it is
A **hosted runtime for AI agents** where a non-infra user fills out a wizard (role, tone, budget tier, interface) and gets back a running bot with a public URL and optional Telegram webhook. Credits-metered. Per-bot isolation via Docker. Shared-fleet economics.

### Who it is for
- Solo operators / indie devs who want a Telegram or web-chat bot without standing up a server.
- SMB ops teams wanting a "deploy support/automation agent" without hiring an infra engineer.
- NOT enterprise yet — no SSO, no audit log surface, no SOC2 posture, no VPC option.

### Core value proposition
"**Describe the agent. We run it.** One wizard step to a live endpoint. Pay for what it actually consumes in tokens/requests, not a flat VM bill." It collapses three things that users would otherwise DIY: the LLM API account, the deployment host, and the gateway + webhook plumbing.

### Category
**"Vercel for AI agents,"** with the caveat that Vercel is serverless-first and this is long-lived-container-first (bots hold webhook state, a serverless cold start per Telegram update would be unacceptable UX). Closer analog: **Fly.io or Render, narrowed to the bot use case, with credits instead of flat pricing.**

### What it is NOT (yet)
- Not a framework — it doesn't provide SDKs, tools, memory stores, RAG, function-calling, or a way for the user to write code. The "agent" is literally a system prompt + model.
- Not multi-tenant inside a bot — a bot serves one owner's traffic; there's no per-end-user session isolation or rate limit.
- Not self-hosted or on-prem.
- Not compliant with anything (HIPAA/SOC2/GDPR DPA) — no posture work done.
- Not a real marketplace — "skills" are static strings in `skill-map.ts`, not executable capabilities.

### Long-term platform vision (realistic)
1. **v1 (now):** system-prompt-only bots, Telegram + web chat, OpenRouter under the hood.
2. **v2:** bring-your-own tools (function calling), RAG document upload per bot, Slack + Discord + WhatsApp interfaces.
3. **v3:** agent teams (multi-bot workflows), scheduled agents (cron triggers), webhook-out integrations.
4. **v4:** custom runtimes (user-supplied Docker image), org accounts + RBAC, audit log, SOC2.

---

## 2. Current Product State (Reality Check)

### What a user can actually do today
1. Sign up / log in (email/password + Google OAuth via NextAuth).
2. Walk a deploy wizard → creates an `Instance` row with `agentConfig`, `soulMd`, `skills`, `modelTier`, `botToken`.
3. In **dev mode** (no `LINODE_API_TOKEN`): the provisioner writes a mock IP and marks the instance `running`. **No actual bot runs.**
4. In **live mode** (Linode + SSH keys set): provisioner SSHes into a BotHost, `docker pull` + `docker run` the bot runtime container, stores `botHostId`, `containerPort`, `ipAddress`.
5. Hit `/g/<id8>/chat` → gateway proxies to the bot container → bot calls OpenRouter → replies.
6. Bot POSTs `/api/usage/ingest` → `UsageEvent` row + `consumeCredits()` in a `$transaction` → auto-pauses bot on zero balance.
7. Dashboard stat cards show live data: active agents, credits remaining, monthly run-rate, 24h incidents.
8. Instance detail page: Restart / Reveal token / Rotate token / Typed-confirm delete — all wired to real routes.
9. Telegram: paste bot token → `/getMe` validates → webhook set to `/tg/<botToken>` → token encrypted with AES-256-GCM at rest → container re-runs with `TELEGRAM_BOT_TOKEN` in env.
10. Stripe: subscription checkout works; `invoice.paid` grants `plan.creditsPerPeriod` credits.

### Is the core business loop complete?
**Technically yes; operationally no.**

The end-to-end loop — user pays → Stripe grants credits → bot runs → usage deducts credits → zero balance pauses bot → user tops up — is **code-complete**. Every step has a code path.

But "complete" and "production-safe" are different. The loop will work for **one careful user in a demo**. It will not survive:
- A Telegram bot getting rate-limited by OpenRouter and retrying infinitely (no circuit breaker).
- Two users clicking Deploy simultaneously on a near-full host (port-allocation race).
- A BotHost crashing (no reconciliation — containers are "lost" from the web app's view).
- OpenRouter returning a 402 because the free tier is exhausted (bot returns error string to Telegram users).
- A malicious user pointing a webhook at `/api/usage/ingest` with someone else's bot token leaked from a screenshot.

**Verdict:** the loop is wired end-to-end but is single-threaded, single-failure-tolerant, and has zero defense in depth.

---

## 3. System Completion Assessment

| Domain | % | What's solid | What's weak / missing | Hidden risk |
|---|---|---|---|---|
| **Auth & User Management** | 85% | NextAuth v5 w/ JWT, Google OAuth + credentials, owner guards on every lifecycle route. | No org/team model, no MFA, no session revocation UI, no audit log of logins. | JWT sessions — no way to force-logout a compromised user except rotating `NEXTAUTH_SECRET`, which logs *everyone* out. |
| **Billing & Credits** | 70% | Stripe webhook verified (`constructEvent`), `grantCredits`/`consumeCredits` are transactional, `CreditLedger` gives audit trail, balance check is atomic. | No top-up flow (deferred from plan), no refund handling, no proration of mid-period plan change, no prepaid credit SKU. | `Plan` table has **no price columns** — monthly spend is reverse-engineered from `ServerConfig.priceMonthly` of running instances, which doesn't match what Stripe actually bills for. Dashboard lies subtly. |
| **Agent Configuration** | 60% | Zod-validated `parseAgentConfig`, deterministic `generateSoul` (good for snapshot tests later), 8 categories with locked skill map. | "Skills" are just strings on the system prompt — they don't enable any capability. No tool-calling, no RAG, no memory. No way to edit a bot's config after deploy (would need new endpoint + `reprovisionBotEnv`). | The product pitch says "intelligent agent" but the implementation is "prompt-engineered chatbot." Truth-in-advertising gap. |
| **Deployment / Provisioning** | 65% | Two clean targets (shared / vps), dev mock fallback preserves local DX, `BotHost` row is source of truth, stack script bootstraps Docker + SSH key. | **Port allocation is not concurrency-safe** (read-set-write). No retry on SSH failure. No rollback on partial failure (container running but DB update fails → orphan). No drain of a BotHost before host-level maintenance. | Two simultaneous deploys to the same host can pick the same port → `docker run -p 4000:3000` succeeds on the first and fails on the second, leaving that Instance in `failed` with a random SSH error. |
| **Runtime (Bot Containers)** | 55% | Tiny Express, fallback model on 429/5xx, fire-and-forget usage reporter, token auth via `X-Bot-Token`. | **No conversation memory** — every `/chat` request starts from zero. **No rate limit per caller.** Telegram handler has no dedupe (Telegram retries on 5xx, you'll get duplicate replies). `reportUsage` is fire-and-forget with no retry queue — dropped usage = free tokens. | Every Telegram message currently costs you OpenRouter tokens even if the end user is spamming. A user's `credits` field is the only brake. |
| **Gateway / Routing** | 70% | Catch-all proxy, hop-by-hop header stripping, streaming response, X-Bot-Token injection, 60s timeout, id8 ambiguity → 409. | `id8` collision probability is small but nonzero at scale (cuid first-8 chars has ~68B combinations; birthday collision kicks in around ~260k bots). No per-bot rate limit. No caching. No WAF. | Gateway runs inside Next.js — every request holds a Node event-loop slot. Long-lived streaming replies starve the API routes on the same instance. |
| **Telegram Integration** | 75% | Token validated via `getMe`, encrypted at rest (AES-256-GCM, IV-per-secret, authTag), webhook centralized, always-200 prevents retry loops. | No webhook secret (Telegram's `X-Telegram-Bot-Api-Secret-Token`) — anyone who knows a bot's public token can spoof updates into our endpoint. No handling of non-message update types (callback_query, inline_query). No media handling. | `X-Bot-Token` leak risk: Telegram webhook path `/tg/<botToken>` puts the botToken **in the URL**, which shows up in reverse-proxy access logs, browser history if ever pasted, and CDN logs. |
| **Observability** | 15% | `InstanceLog` table captures provisioning/restart/delete/credit-exhaustion events with levels. | **No metrics, no traces, no uptime monitoring, no dashboards, no alerts, no centralized log aggregation.** `console.warn` is the error-reporting strategy. No Sentry, no OpenTelemetry, no Prometheus endpoint on bot runtime. | You will find out your fleet is down when a customer tweets at you. |
| **DevOps / Infrastructure** | 40% | GHCR workflow, stack script bootstraps hosts, `bootstrap-shared-host.ts` is idempotent, `serverExternalPackages` solves ssh2 bundling. | No host autoscaling (must run `pnpm bootstrap:host` manually when fleet fills). No health checks on BotHost. No automatic image rollout (containers stay on old runtime until user clicks Restart). No backups of SQLite DB. No migration of containers if host dies. | SQLite is the production database. One disk failure = total data loss. |
| **Security** | 45% | Stripe sig verified, AES-256-GCM for Telegram tokens, NextAuth handles password hashing, owner guards everywhere. | Bot tokens stored **plaintext** in DB (`Instance.botToken`). Gateway auth is just "this proxy knows the token." No per-bot outbound egress control — a compromised bot runtime can exfil to anywhere. Containers share host network with every other bot. Root SSH to shared host = fleet compromise. | **One compromised BotHost root key = every bot's env (including Telegram tokens decrypted by the app).** |

---

## 4. Feature Completion Matrix

| Feature | Status | Notes |
|---|---|---|
| Sign up / log in | ✅ | Credentials + Google OAuth. |
| Deploy agent (wizard → running) | ⚠️ | Works in dev (mock IP). Works in live mode but has the port-race and no-rollback issues above. |
| Restart bot | ✅ | `sshDockerRestart`; mock-safe in dev. |
| Delete bot | ⚠️ | Works; best-effort cleanup on SSH failure (swallows error, marks DB deleted → can leave zombie container on host). |
| Pause / Resume | ✅ | Wired via `pauseBot`/`resumeBot` but no UI button for manual pause (only auto-pause on credit exhaustion triggers it). |
| Reveal bot token | ✅ | `GET /api/instances/[id]/token`, owner-guarded. |
| Rotate bot token | ✅ | Mints new token, `reprovisionBotEnv` restarts container with new env. |
| Telegram connect | ⚠️ | Token validated + encrypted + webhook set. No webhook secret, no support for group-chat peculiarities, no disconnect/rebind flow. |
| Web chat UI | ❌ | There is no user-facing chat UI served by the bot. Users must `curl /g/<id8>/chat` themselves. |
| Credit deduction (per request) | ✅ | Atomic `$transaction` in `consumeCredits`, auto-pause on exhaustion. |
| Credit top-up | ❌ | Stripe one-time payment for credits not built; credits only come in via `invoice.paid` on subscription. |
| Stripe subscription checkout | ✅ | Works; tested in plan. |
| Stripe webhook → provision | ✅ | `handleCheckoutSessionCompleted` calls `provisionBot`. |
| Stripe webhook → grant credits | ✅ | `handleInvoicePaid` grants `plan.creditsPerPeriod`. |
| Usage tracking (UsageEvent rows) | ✅ | Writes on every ingest. |
| Dashboard — active agents | ✅ | Real DB count. |
| Dashboard — credits remaining | ✅ | Real. |
| Dashboard — monthly spend | ⚠️ | Computed from `ServerConfig.priceMonthly` of running instances — **not** what the user is actually billed by Stripe. Misleading. |
| Dashboard — 24h incidents | ✅ | Counts `InstanceLog` with `level="error"` in last 24h. |
| Error handling UX | ❌ | Most API routes return `{ error: string }` with 4xx/5xx. The UI shows a toast with the string. No retry, no contextual help, no status-page link. |
| Per-bot monitoring (latency, success rate, last error) | ❌ | Dashboard "monitoring" tab exists but is cosmetic. |
| Agent config editing post-deploy | ❌ | Would require a new endpoint + `reprovisionBotEnv`. |
| Audit log for user actions | ❌ | Route stub exists; no records written. |
| Team / org accounts | ❌ | Single-user only. |
| RAG / file upload | ❌ | Not in scope v1. |
| Function calling / tools | ❌ | Not in scope v1. |

---

## 5. Codebase Reality Check

### A) Strong areas
1. **`src/lib/credits.ts`** — `grantCredits` and `consumeCredits` wrap in `prisma.$transaction` and re-check balance inside the transaction. This is correct. Most juniors get this wrong.
2. **`src/lib/crypto-secret.ts`** — AES-256-GCM with per-secret IV and authTag. Not ECB, not CBC-without-MAC. Accepts both hex and base64 keys. Correct.
3. **`src/lib/soul.ts`** — Pure, deterministic, no timestamps. Snapshot-testable. Good engineering taste.
4. **`src/lib/ssh.ts`** — `shellEscape` wraps every interpolation in single-quoted bash escapes. Injections via bot name / container name are prevented.
5. **Gateway's hop-by-hop header filter** (`src/app/g/[id8]/[...path]/route.ts`) — matches the RFC 7230 list. Correct.
6. **`bot-runtime/src/chat.ts`** — fallback on 429 *and* on network throw, and on the fallback path still reports usage. Correct shape for a resilient LLM client.
7. **`prisma/schema.prisma`** — Unique constraints on `linodeId`, `botToken`, `stripeSubscriptionId`. Indexes on `userId` and `status`. The schema is well-designed.

### B) Fragile areas
1. **Port-allocation race** — `allocatePort()` is read-scan-return with no row lock. Two concurrent `provisionBot` calls on the same host *will* collide.
2. **Bot-runtime has no conversation memory** — every `/chat` starts with only system prompt + current message. For Telegram this means the bot has amnesia every turn. Users will notice immediately.
3. **Usage reporter is fire-and-forget** — `reportUsage` in `bot-runtime/src/usage.ts` doesn't retry. A network blip = you gave away tokens.
4. **`id8` ambiguity handling returns 409** — correct detection, but no fallback. User is told "use a longer prefix" with no way to do so in the UI.
5. **`provisionVpsBot` sleeps 10 seconds for cloud-init** — magic number. On a slow Linode this will SSH-fail; on a fast one it wastes 10 seconds.
6. **Dev vs. live mode is a boolean (`isLiveMode()`)** — returns true if *both* `LINODE_API_TOKEN` *and* `SSH_FLEET_PRIVATE_KEY` exist. Set one but not the other = silently behaves as dev. No startup warning.
7. **`rate-limit.ts` is an in-memory Map** — doesn't survive process restart, doesn't share state across Next.js serverless instances. Useless in any deployment beyond single-process.
8. **Gateway fetch has no retry** — one network hiccup and the caller sees 502.
9. **`provisionSharedBot` writes Instance row only after `sshDockerRun` returns** — if the SSH call succeeds but the DB update fails, you have an orphaned container the app doesn't know about. Reverse is also true: DB says "running" but `docker ps` shows nothing.

### C) Anti-patterns
1. **SQLite in production.** `better-sqlite3` is in deps. Fine for dev, fatal for multi-instance Next.js. Migrate to Postgres before any real traffic.
2. **No queue/worker.** `provisionBot` is called inline inside `POST /api/deploy`. A 30-second Linode boot blocks the HTTP response. The user will think the request hung.
3. **`console.warn` as error reporting.** In production (Vercel/Fly) these lines go to stdout and nowhere else useful.
4. **Secrets in container env, logged on `docker inspect`.** Bot token, OpenRouter API key, Telegram token all passed as `-e` flags. A compromised host reveals all of them via a single `docker inspect bot_*`.
5. **Shared OpenRouter API key across the fleet.** Every bot uses `process.env.OPENROUTER_API_KEY` from the web app. Free-tier rate limit (~20 req/min) is shared. One noisy bot = every other bot throttled. And if OpenRouter bans the key, the whole fleet dies.
6. **Gateway runs inside Next.js.** Long streaming responses hold the Node event loop of an API route. Should be a separate lightweight proxy (Caddy, nginx, or a dedicated Hono service) with zero business logic.
7. **No idempotency on Stripe webhooks.** `handleInvoicePaid` will `grantCredits` twice if Stripe retries. The reason string includes `invoice.id` but there's no DB-level unique constraint on `CreditLedger(reason)` to prevent duplicates.

---

## 6. Infrastructure & Scaling Limits

### Per-host capacity (shared Linode g6-standard-2: 4 GB RAM, 2 vCPU)
- `BotHost.capacity = 15` is a **soft cap** in the scheduler.
- Realistic: a Node 20 container with Express + OpenRouter fetch idles at ~60–90 MB RSS. **15 × 80 MB ≈ 1.2 GB.** Headroom is fine at rest.
- Under load (all 15 bots handling one `/chat` each, each with a pending fetch to OpenRouter): event loops are cheap, but if any bot holds a long Telegram `sendMessage` the host can CPU-starve on the 2 vCPU. **Realistic effective cap: 15 bots at low QPS, ~5 bots at sustained 1 req/s each.**
- Port range 4000–5999 gives 2000 ports; the capacity cap of 15 is the binding limit, not ports.

### Fleet totals
| Fleet size | Capacity | First bottleneck |
|---|---|---|
| 1 host | 15 bots | OpenRouter shared key rate limit (~20 req/min burst) |
| 5 hosts | 75 bots | Scheduler race conditions become regular, SQLite write contention on `UsageEvent` |
| 20 hosts | 300 bots | No autoscaling — you're manually running `pnpm bootstrap:host`. SQLite hard-dies here. No monitoring means you won't know a host is wedged. |
| 70 hosts | 1000+ bots | Gateway-in-Next.js becomes the bottleneck. Telegram webhook bursts overwhelm single-process Next. No circuit breakers on OpenRouter. |

### What breaks first, in order
1. **~30 bots:** SQLite write contention on `UsageEvent` (every `/chat` writes a row). Postgres migration forced.
2. **~50 bots:** OpenRouter free-tier rate limit across the fleet. Paid key required, cost goes from $0 → real.
3. **~100 bots:** Manual host provisioning becomes a chore. `BotHost` reconciliation gap (crashed containers undetected) produces ghost "running" instances.
4. **~200 bots:** Gateway latency spikes when one bot streams — head-of-line blocking in Next.
5. **~500 bots:** One SSH key, one OpenRouter key. A key compromise is existential.
6. **~1000 bots:** You cannot diagnose a failure. `console.warn` in a `docker logs` on one of 70 hosts is not findable.

---

## 7. Critical Missing Pieces (prioritized)

### P0 — Must ship before ANY real traffic
1. **Postgres migration.** SQLite cannot survive production. Plan: add `DATABASE_URL`-switchable Prisma provider, migrate locally, run `pnpm prisma migrate deploy` on Fly/Railway Postgres.
2. **Stripe webhook idempotency.** Add unique index on `CreditLedger(reason)` where reason contains `invoice.id`. Or dedicated `ProcessedStripeEvent(id)` table.
3. **Port-allocation locking.** Wrap pick+write in `SELECT … FOR UPDATE` (Postgres) or an app-level mutex keyed on host id.
4. **Don't block HTTP on `provisionBot`.** Move provisioning to a job queue (BullMQ on Redis, or even a DB-backed queue with `ProvisionJob` rows). Return 202 immediately, poll status.
5. **Rotate `Instance.botToken` to hashed storage.** Store a SHA-256 of the token, keep cleartext only in container env. Reveal endpoint becomes "rotate to see" (generate new, return once).
6. **Telegram webhook secret.** Set `secret_token` on `setWebhook`, verify `X-Telegram-Bot-Api-Secret-Token` on every `/tg/...` request.
7. **Dedicated per-bot OpenRouter keys** (or at least per-host) — otherwise one noisy bot rate-limits everyone.

### P1 — Before 100 bots
8. **Health checks.** BotHost heartbeat (`cron` SSH `docker ps` every 30s → reconcile DB). Bot runtime `/health` endpoint already referenced but not implemented in `bot-runtime/src/index.ts` (verify).
9. **Reconciler loop.** A periodic job that walks `Instance.status = "running"` rows, SSHes the host, confirms container is actually running; flips to `failed` if not.
10. **Sentry or equivalent.** Both control plane and bot runtime. Without this, you're debugging in the dark.
11. **OpenTelemetry spans** across deploy → provision → first chat. This is the critical path and you can't see it.
12. **Rate limits on gateway.** Per-bot token bucket. Upstash Redis or similar.
13. **Conversation memory.** Even a naive 10-turn window per `(botToken, chatId)` in Redis would fix the amnesia complaint.
14. **Auto-retry on usage-ingest failure.** Buffer in the bot container, flush on success.

### P2 — Before 1000 bots
15. **Autoscaling of BotHost fleet.** When cluster > 80% full, bootstrap a new host automatically.
16. **Separate gateway service** off Next.js — a Hono-on-Cloudflare-Workers or a dedicated Node+Fastify process.
17. **Per-bot egress firewall.** Docker network policies: bots can talk to OpenRouter and `USAGE_INGEST_URL` only.
18. **Abuse detection.** Flag bots with runaway token consumption (>10× rolling p95) for auto-pause + owner notification.
19. **Secrets from a vault** (HCP Vault / Doppler / AWS Secrets Manager) instead of `.env` on each host.
20. **Backup + PITR** on Postgres.

---

## 8. Security Assessment

### Token system
- **Bot tokens (`sk_bot_...`):** 24 bytes random, correct entropy. **Stored in cleartext in DB.** Reveal endpoint returns them. Used as both auth secret and URL path component (Telegram webhook). **Medium/High risk.** Minimum fix: hash-at-rest, show-once-on-rotate.
- **Telegram tokens:** encrypted AES-256-GCM at rest. Correct. Key is in `INSTANCE_ENCRYPTION_KEY` env. Loss of that env = permanent loss of all Telegram tokens (no recovery). Document this.
- **SSH fleet key:** single key, in the web app's env, with root access to every BotHost. **Compromise of this key = fleet compromise.** Medium-term: per-host ephemeral keys via a bastion or SSH CA.

### API protection
- Owner guards on all `/api/instances/[id]/*` routes via `auth()`. Correct.
- `/api/usage/ingest` authed by `X-Bot-Token` — correct, *but* if a bot token leaks (e.g., from a bot log), an attacker can inject fake usage events. Current impact: they can drain *that bot owner's* credits. Not catastrophic but annoying. Mitigation: rate limit per-botToken at ingest.
- `/api/webhooks/stripe` uses `stripe.webhooks.constructEvent` → signature verified. Correct.
- **No CSRF protection noted** — Next.js App Router defaults + `credentials: "same-origin"` fetches probably cover this, but not audited.

### Container isolation
- Shared Docker host, bots share kernel and host network namespace (unless `--network=bridge` default, which gives them NAT'd outbound).
- **No memory/CPU limits on `docker run`** — one bot can OOM the host.
- No seccomp, no user namespace, no read-only rootfs. Bot runtime runs as root in container.

### Webhook validation
- Stripe: ✅ verified.
- Telegram: ❌ no `secret_token`. Medium vulnerability — anyone can POST to `/tg/<known-bot-token>` and make our system forward a crafted "update" to the bot.
- Gateway: no validation that the caller is authorized to hit a given `id8` — it's public by design. Fine for the product's "expose my bot on the internet" pitch, but means every bot is a public endpoint; DDoS surface.

### Secret management
- `.env` / `.env.local` on developer machines; env vars on host in prod. Standard but weak. No rotation, no audit, no just-in-time access. 
- `docker inspect` on a BotHost reveals: OpenRouter API key, Telegram bot token (cleartext at runtime), our ingest URL. **Anyone with root on a BotHost has the kingdom.**

### Immediate vulnerabilities (fix this week)
1. Hash-at-rest bot tokens.
2. Add Telegram webhook `secret_token`.
3. Add resource limits (`--memory=256m --cpus=0.5`) to `sshDockerRun`.
4. Add unique/idempotency check on Stripe event processing.

### Medium-term risks
1. Single SSH key for the fleet.
2. Shared OpenRouter key.
3. No egress control on bot containers.
4. No abuse detection.

---

## 9. Technical Debt Assessment

### A) Architectural debt

| Debt | Why it exists | Impact if unfixed | Severity |
|---|---|---|---|
| **No job queue.** `provisionBot` runs inline in the request. | Shipped fast; no Redis yet. | HTTP timeouts on slow Linode boots; user perceives "hung." Retries impossible. | **High** |
| **Gateway inside Next.js.** | Reusing the deployed app; no separate service. | Head-of-line blocking under streaming. Scaling gateway = scaling the whole app. | **High** |
| **No scheduler abstraction.** `pickHost` + `allocatePort` are raw DB reads. | Simplicity first. | Race conditions under concurrency. | **High** |
| **SQLite.** | Dev ergonomics. | Hard ceiling at ~30 bots of sustained ingest. | **High** |
| **No abstraction between "deployment target" and provider.** Logic branches on `target === "vps"` inline. | Only two targets so far. | Adding a third (Fly.io, Hetzner, Docker-on-own-host) means touching `provisionBot`, `restartBot`, `deleteBot`. | **Medium** |
| **Stripe state spread across `Subscription` + `Plan` + lack of price columns.** Monthly spend reverse-engineered from `ServerConfig`. | Schema predates pricing rewrite. | Dashboard "Monthly Spend" is a lie. | **Medium** |
| **"Skills" are strings, not capabilities.** | MVP. | Product pitch diverges from implementation. | **Medium** (product, not tech) |

### B) Infrastructure debt

| Debt | Why | Impact | Severity |
|---|---|---|---|
| **SSH-based orchestration.** | No K8s, kept it simple. | No declarative state — containers drift from DB. No self-healing. | **High** |
| **No service discovery.** Instance row holds IP + port; stale on host swap. | Static fleet. | Moving a container = writing a migration script. | **Medium** |
| **No autoscaling.** Must run `pnpm bootstrap:host` by hand. | Demo-scale. | Ops toil grows linearly with users. | **Medium** — upgrades to **High** past 10 hosts |
| **No reconciliation loop.** | Not built. | Ghost "running" rows after host reboot. | **High** |
| **No database backups.** | SQLite. | One disk fault = total loss. | **High** |
| **No TLS termination strategy documented for bot runtime.** | Runs over plain HTTP on host IP:port. | Gateway → bot traffic is cleartext over Linode's internal net. Usage tokens sniffable on a compromised host. | **Medium** |

### C) Code-level debt

| Debt | File / line | Impact | Severity |
|---|---|---|---|
| In-memory rate limit | `src/lib/rate-limit.ts` (15 lines, Map) | Useless on multiple Node processes | **High** |
| 10-second magic `setTimeout` after Linode create | `src/lib/provisioner.ts:218` | Flaky on slow boots | **Medium** |
| Hardcoded port range 4000–5999 | `src/lib/host-scheduler.ts:65` | OK for now, not enforced elsewhere | **Low** |
| Hardcoded capacity 15 | Prisma `BotHost.capacity @default(15)` | Can be overridden, but no dynamic tuning | **Low** |
| `generateRootPassword` uses `Math.random` | `src/lib/provisioner.ts:88` | Linode ignores it (we use SSH keys), but still a code smell | **Low** |
| `console.warn` as error channel | Throughout `provisioner.ts`, `stripe-events.ts`, `tg/route.ts` | Errors lost in prod logs | **High** (operational) |
| `BOT_RUNTIME_IMAGE` defaults to `ghcr.io/sovereignml/...:latest` | `provisioner.ts:23` | "latest" tag = reproducibility nightmare. Mutates under you. Pin by SHA. | **Medium** |
| `NEXT_PUBLIC_GATEWAY_BASE_URL` default `http://localhost:3000` | `provisioner.ts:26` | If env is missing in prod, bots try to POST usage to the Linode host's localhost. Silent breakage. | **Medium** |
| No validation of `agentConfig` size or nesting depth | `parseAgentConfig` | User can submit an enormous soul markdown, bloat DB | **Low** |
| No timeout on SSH commands | `sshRun` has `readyTimeout` only | Hung SSH = hung HTTP request | **Medium** |

### D) Operational debt

| Debt | Impact | Severity |
|---|---|---|
| **No metrics.** No RED (rate/errors/duration), no USE (utilization/saturation/errors). | Debugging by intuition. | **High** |
| **No alerting.** No one gets paged when a host goes down. | You find out from customers. | **High** |
| **No runbook for BotHost replacement.** | When a host dies, engineer improvises. | **High** |
| **No staging env.** | Changes tested in prod. | **High** |
| **Image rollout is manual** — existing bots stay on old runtime until owner clicks Restart. | Security patches don't propagate. | **Medium** |
| **Logs are per-container, per-host.** No aggregation. | "Which bot errored at 3am?" = SSH to each host and `docker logs`. | **High** |
| **Dev vs. prod mode switch is implicit** (`isLiveMode()`). | Silent misconfiguration. | **Medium** |

### E) Product debt

| Debt | Impact | Severity |
|---|---|---|
| "Monthly Spend" stat card is reverse-engineered, not Stripe truth. | User trust. | **Medium** |
| No bot-level error surface in UI (last error, last successful message). | Users can't self-diagnose. | **High** |
| No "chat with your bot" UI. Gateway exists but no UI calls it. | Demo → production feels like a drop-off. | **High** |
| No credit top-up flow (only subscription renewal grants credits). | User runs out mid-day → must wait for next cycle. | **High** |
| No agent edit flow. | Deploy wizard is one-shot; typos force delete+redeploy. | **High** |
| No "pause" button in UI — only auto-pause on zero balance. | Can't temporarily disable a bot. | **Low** |
| Telegram bind has no "disconnect/rebind" UI. | Token fatigue, no recovery path. | **Medium** |
| No email notifications (credit low, bot paused, deploy failed). | Users notice only when checking dashboard. | **Medium** |
| `skill-map.ts` is a fake feature — product pitch vs. reality mismatch. | If a user expects "my sales bot can book meetings," we will disappoint them. | **High** |

---

## 10. What Is Actually Production-Ready

**Fully production-ready:**
- NextAuth login flow (credentials + Google).
- Stripe subscription checkout + signature-verified webhook.
- Credit grant/consume transactional logic.
- AES-256-GCM secret encryption.
- Soul/skill/model-routing pure libs (deterministic, testable).
- Owner-guarded lifecycle routes (the auth checks themselves).
- Dashboard stat queries (the SQL is correct; the "monthly spend" semantic is wrong but the query is fine).

**Looks done, will fail under real usage:**
- Deploy flow (inline provisioning, port race, no rollback).
- Gateway (runs in Next.js event loop, no rate limiting).
- Usage ingest (no idempotency, no retry from bot side).
- Telegram integration (no webhook secret, no memory, no dedupe).
- BotHost fleet management (no reconciliation, no autoscale).
- SQLite database.
- Shared OpenRouter key.
- Error reporting (console.warn only).

**Do not ship without fixing:**
- Postgres.
- Stripe idempotency.
- Port allocation locking.
- Telegram webhook secret.
- Bot token hash-at-rest.
- Basic Sentry integration.

---

## 11. Roadmap

### Phase 1 — Stabilization (Weeks 1–3, now)
**Goal: the system does not silently break for a demo user.**

Engineering:
- Migrate Prisma provider to Postgres (Fly/Railway managed).
- Introduce BullMQ-on-Redis. Convert `provisionBot` to a job; `/api/deploy` returns 202 + polls.
- Add pessimistic locking to `pickHost`+`allocatePort` (advisory lock in Postgres, keyed on `botHostId`).
- Hash-at-rest for `Instance.botToken`. Cleartext only in container env + one-time reveal-on-rotate.
- Telegram webhook `secret_token` end-to-end.
- Stripe idempotency: `ProcessedStripeEvent(id)` table, upsert before handler runs.
- Wire Sentry in both control plane and bot runtime. Replace `console.warn` with `logger.error` via pino.
- Bot runtime: `/health` endpoint, per-call rate limit (simple token bucket per caller IP), and a retry-on-failure buffer for `/api/usage/ingest`.
- `BOT_RUNTIME_IMAGE` pinned to SHA in env; document rollout procedure.
- Bot container resource limits: `--memory=256m --cpus=0.5`.

Infra:
- Single staging environment on Fly/Railway.
- One production BotHost in Newark + one in Frankfurt (failure domain separation).
- Nightly `pg_dump` → object storage.

Architecture:
- Extract `provisioner` + `ssh` + `host-scheduler` into a package boundary (no more `@/lib/*` imports; explicit interface). Pre-work for extracting to a worker service.

### Phase 2 — Controlled Scale (~100–300 bots, Weeks 4–10)
**Goal: the system self-heals and is observable.**

Engineering:
- Reconciler job (every 60s): SSH each BotHost, `docker ps`, update `Instance.status`, mark ghosts as `failed`.
- Host-heartbeat: each BotHost runs a tiny agent that POSTs `/api/bots/heartbeat` every 30s with `containerName → { uptime, memory }`.
- Autoscale trigger: if fleet utilization >75% for 10 minutes, kick a BullMQ job that runs `bootstrap-shared-host.ts`.
- Per-bot conversation memory: Redis `LIST bot:<id>:<chatId>` with 20-turn cap.
- Per-bot rate limit: token bucket in Redis, default 1 RPS per end-user, configurable in wizard.
- Per-host OpenRouter key: allocate and rotate automatically.
- Abuse detection: rolling p95 of tokens/min per bot; `level="warn"` InstanceLog if >10×.
- Credit top-up Stripe one-time payment + `price_credits` SKU.
- Agent-edit flow: endpoint + wizard step 2 + `reprovisionBotEnv`.
- Email notifications via Resend: credit-low, deploy-failed, bot-paused.

Infra:
- Move gateway to a separate Hono service (Fly or Cloudflare Worker) in front of the BotHost IPs. Next.js no longer proxies.
- Grafana Cloud (logs+metrics+traces). Prometheus scrape on each BotHost.
- On-call rotation + PagerDuty hooked to Sentry + uptime.
- Terraform for BotHost provisioning (replace the stack script ad-hoc).

Architecture:
- Extract `provisioner` + workers into a standalone Node service deployed separately from Next.js.
- Move from SSH+Docker to SSH+systemd+Docker with explicit unit files for per-bot containers. Enables `systemctl status` per bot.

### Phase 3 — Real Scale (1000+ bots, Month 3+)
**Goal: platformization; multi-region; zero-touch ops.**

Engineering:
- Multi-region fleet with geo-aware `pickHost` (latency to user).
- Pluggable runtime: allow user to supply their own Docker image (with a spec: must expose `/chat`, `/health`, accept `BOT_TOKEN`, POST usage).
- Tool-calling runtime tier: OpenRouter function-calling support, prebuilt tool pack (web search, HTTP GET, scheduled message).
- RAG per bot: Pinecone/Weaviate, upload docs in wizard, chunk+embed on upload, inject top-k into system prompt.
- Org/team accounts + RBAC + audit log surface.
- Webhook-out integrations: bot can POST to user-configured URL.

Infra:
- Replace SSH+Docker with **Nomad** (lightweight, not K8s). Keep per-bot container model. Nomad handles placement, restart, bin-packing.
- Egress firewall per bot (Cilium / Nomad Consul-Connect) — bot can only talk to OpenRouter + ingest URL by default; opt-in outbound allowlist in the wizard.
- Secrets in HCP Vault or Doppler; never in container env. Bot runtime pulls on start.
- Multi-tenant Postgres sharding by `userId` at ~10M UsageEvent rows.

Architecture:
- Control plane splits into: `api` (Next.js, SSR + auth), `gateway` (Hono/Workers), `provisioner` (worker service), `reconciler` (cron service). Each deployable independently.
- Event bus (NATS or Kafka) for: `instance.provisioned`, `usage.ingested`, `credits.exhausted`, `bot.paused`. Decouples domains.

---

## 12. Final Verdict

### Is this MVP, post-MVP, or scalable?
**Mid-MVP.** The full loop works end-to-end for exactly one happy-path user on a localhost or a lightly-loaded dev Linode. It is a working demo, not a product.

Calibration:
- **MVP floor:** "you can sign up and get a running bot." ✓ met.
- **Post-MVP:** "ten real users can use this in parallel without the operator babysitting." **Not met.** Port race, shared OpenRouter key, no monitoring, no reconciliation.
- **Scalable:** "a thousand bots run and the operator sleeps through the night." **Not close.**

### Suitable company stage
**Friends-and-family private beta.** Charge nothing. Recruit 5–10 users who will forgive incidents and give feedback. Don't take Stripe payments from strangers on this codebase until **Phase 1** of the roadmap lands.

### Biggest risk right now
**Silent data loss + silent fleet drift.** In order of likelihood:
1. SQLite file corruption or container restart → every user's history gone.
2. A crashed BotHost container → Instance row says "running," user pays credits for a dead bot, you find out when they rage-tweet.
3. Stripe webhook retry on `invoice.paid` → same user granted credits twice → finance reconciliation nightmare at tax time.

Fixable in **two weeks** by one focused engineer with: Postgres migration, BullMQ queue, reconciler loop, Sentry, Stripe idempotency. Do those five things before you do anything else.

Everything past that is optimization. Those five are survival.

---

*End of audit.*
