# SovereignML — Developer Guide

A plain-language walkthrough of everything in this codebase: what it does, how the pieces fit together, and where to look when something breaks.

---

## What Is SovereignML?

SovereignML is a **platform for deploying and managing AI agents**. Think of it as "Heroku for AI bots." A user signs up, picks a plan, configures an agent (what it does, how it talks, which AI model it uses), and clicks deploy. The platform spins up real infrastructure — a VPS or a shared Docker container — installs the agent software, wires up DNS, and starts the bot. The user gets a dashboard to monitor, restart, pause, or delete their agents.

The product has five pricing tiers (Free → Builder → Operator → Scale → Enterprise), a credit-based usage system, Stripe billing, team collaboration, and an admin panel.

---

## Tech Stack

For a full rationale (including **Prisma vs Drizzle**), see [TECH-STACK.md](TECH-STACK.md).

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui |
| Backend | Next.js API Routes (all in `src/app/api/`) |
| Database | PostgreSQL via Drizzle ORM (`src/db/schema.ts`) |
| Auth | NextAuth v5 (credentials + Google OAuth) |
| Payments | Stripe (subscriptions + webhooks) |
| Infra Provider | Linode API (`src/lib/linode.ts`) — abstracted behind `VmProvider` interface |
| DNS | Cloudflare API (`src/lib/cloudflare.ts`) |
| Bot Runtime | Standalone Express server in `bot-runtime/` — runs inside each deployed agent |
| AI Models | OpenRouter (routes to Llama, Gemini, Claude depending on tier) |
| Email | Resend (`src/lib/email.ts`) |

---

## Project Structure

```
sovereign/
├── src/
│   ├── app/                    # Next.js App Router pages + API routes
│   │   ├── (auth)/             # Login, register, forgot/reset password, banned
│   │   ├── (marketing)/        # Landing, pricing, docs, legal pages
│   │   ├── admin/              # Admin panel (users, instances, revenue, subscriptions)
│   │   ├── dashboard/          # User dashboard (instances, deploy, billing, team, etc.)
│   │   ├── api/                # All backend API routes
│   │   │   ├── deploy/         # POST /api/deploy — the main deploy endpoint
│   │   │   ├── instances/      # CRUD + lifecycle for instances
│   │   │   ├── webhooks/stripe/# Stripe webhook handler
│   │   │   ├── usage/ingest/   # Bot runtime reports usage here
│   │   │   ├── billing/        # Billing info + Stripe portal
│   │   │   ├── team/           # Team invites, members, accept
│   │   │   ├── admin/          # Admin-only endpoints
│   │   │   └── ...
│   │   ├── g/[id8]/[...path]/  # Gateway proxy route
│   │   └── tg/[botToken]/      # Telegram webhook proxy
│   │
│   ├── lib/                    # Core business logic (the important stuff)
│   │   ├── provisioner.ts      # Orchestrates creating/deleting/restarting VMs + containers
│   │   ├── instance-state.ts   # State machine for instance lifecycle
│   │   ├── vm-provider.ts      # Abstract VM interface (currently Linode)
│   │   ├── ssh.ts              # All SSH operations (bootstrap, docker, systemd, health)
│   │   ├── openclaw.ts         # OpenClaw agent config/env/Caddyfile/systemd generation
│   │   ├── host-scheduler.ts   # Pick least-loaded shared host + allocate ports
│   │   ├── reconciler.ts       # Background sweep: orphan VMs, stuck provisions, failed deletes
│   │   ├── stripe.ts           # Stripe client setup
│   │   ├── stripe-events.ts    # Webhook event handlers (checkout, invoice, subscription)
│   │   ├── credits.ts          # Credit grant/consume/balance (transactional)
│   │   ├── agent-config.ts     # Zod schema for agent configuration
│   │   ├── agent-dns.ts        # Cloudflare DNS subdomain management
│   │   ├── model-router.ts     # Maps budget tier → AI model
│   │   ├── soul.ts             # Generates the SOUL.md persona for each bot
│   │   ├── cloudflare.ts       # Low-level Cloudflare API calls
│   │   ├── domain-verify.ts    # Domain verification via DNS TXT records
│   │   ├── instance-queries.ts # Shared DB query helpers for instances
│   │   ├── crypto-secret.ts    # AES encrypt/decrypt for secrets at rest
│   │   ├── email.ts            # Send password reset + team invite emails
│   │   ├── pricing.ts          # Price calculation helpers
│   │   └── ...
│   │
│   ├── configs/                # Static configuration (no DB, no env)
│   │   ├── plans.ts            # Pricing tiers, credits, display prices
│   │   ├── branding.ts         # Product name, URLs, taglines
│   │   ├── regions.ts          # Available deployment regions
│   │   ├── server-types.ts     # Server size configs (vCPU, RAM, storage)
│   │   ├── agent-categories.ts # Agent use-case categories for the UI
│   │   ├── skill-map.ts        # Maps agent config → skills
│   │   └── deploy-templates.ts # Pre-built deploy templates
│   │
│   ├── db/
│   │   ├── schema.ts           # THE database schema (single source of truth)
│   │   ├── index.ts            # Drizzle client + re-exports
│   │   └── seed.ts             # Seeds plans, regions, server configs
│   │
│   └── components/             # React components (UI, layout, marketing, dashboard)
│
├── bot-runtime/                # Separate Node.js app deployed INTO each agent
│   └── src/
│       ├── index.ts            # Express server (/health, /chat, /telegram)
│       ├── chat.ts             # OpenRouter LLM calls with fallback
│       ├── telegram.ts         # Telegram update handler
│       └── usage.ts            # Reports usage back to the platform
│
├── scripts/                    # One-off ops scripts
│   ├── bootstrap-pg.sh         # Set up Postgres
│   ├── bootstrap-shared-host.ts# Provision a new shared Docker host
│   ├── bake-golden-image.ts    # Bake a Linode golden image
│   ├── cloudflare-bootstrap.ts # Cloudflare initial setup
│   └── migrate-sqlite-to-pg.ts # Migration from SQLite (legacy)
│
└── deploy/                     # Deployment configs (PM2, systemd)
```

---

## The Core Flow: How Deploying an Agent Works

This is the most important flow in the entire codebase. Here's what happens step by step when a user clicks "Deploy":

### 1. User Submits Deploy Form
The dashboard deploy page (`src/app/dashboard/deploy/page.tsx`) collects:
- Agent name
- Plan (free/builder/operator/scale)
- Agent config (use case, tone, target audience, budget tier, interface type, deployment target)
- Optionally: region, SSH key, root password

### 2. POST /api/deploy (`src/app/api/deploy/route.ts`)
This is the central deploy endpoint. It:

1. **Authenticates** the user via NextAuth session
2. **Resolves the plan** from `configs/plans.ts` — maps plan slug to server config, credits, etc.
3. **Parses agent config** via Zod (`lib/agent-config.ts`) — validates use_case, tone, budget_tier, deployment_target, etc.
4. **Generates agent identity**:
   - `selectSkills()` picks skills based on the agent config
   - `generateSoul()` creates a SOUL.md persona document (system prompt)
   - `routeModel()` maps budget tier to specific LLM models
   - Generates a unique `botToken` for authentication
5. **Creates the Instance row** in the database with status `"pending"`
6. **Routes based on plan tier**:
   - **Free tier**: Bypasses Stripe, immediately calls `provisionBot()`, creates subscription, grants credits
   - **Paid tier with Stripe**: Creates a Stripe Checkout session, returns the checkout URL. Provisioning happens later via webhook.
   - **Dev mode (no Stripe)**: Auto-provisions like free tier

### 3. Stripe Webhook (`src/app/api/webhooks/stripe/route.ts`)
For paid plans, after the user pays:
- Stripe sends `checkout.session.completed`
- The handler in `stripe-events.ts` reads the `instanceId` from metadata
- Calls `provisionBot()` to actually create the infrastructure
- Creates the Subscription row in the DB

### 4. provisionBot() (`src/lib/provisioner.ts`)
This is the heavy lifter. It acquires a per-instance advisory lock (Postgres `pg_try_advisory_xact_lock`) to prevent double-provisioning, then:

**Shared deployment** (Docker containers on managed fleet):
1. `pickHost()` — finds the least-loaded BotHost
2. `allocatePort()` — finds an unused port in 4000-5999
3. `sshDockerRun()` — SSHes into the host and runs the bot-runtime container
4. Transitions instance to `"running"`

**VPS deployment** (dedicated VM with OpenClaw):
1. **Create VM** — Calls Linode API to spin up a new server (optionally from a golden image)
2. **Wait for boot** — Polls until the VM has an IP and is running
3. **DNS** — Creates a Cloudflare A record pointing `{adjective}-{noun}.sovereignclaw.xyz` to the VM IP
4. **Wait for SSH** — Polls until SSH is reachable
5. **Bootstrap** — Waits for cloud-init to install dependencies (Node.js, Caddy, OpenClaw)
6. **Write config** — SSHes in and writes `.env` + `openclaw.json` with credentials, model config, gateway token
7. **Install service** — Writes Caddyfile (reverse proxy), systemd unit, starts the OpenClaw gateway
8. **Health check** — Waits for the gateway port to listen, runs HTTP health check
9. **Commit** — Transitions instance to `"running"`, stores encrypted credentials

If anything fails, it runs `rollbackProvisioning()` which deletes the VM (with retries) and marks the instance as `"failed_provisioning"`.

### 5. The Bot Is Live
Once running, the bot:
- Serves an HTTP API (OpenClaw gateway on VPS, or bot-runtime Express server on shared)
- Gets a managed subdomain like `my-bot-bold-hawk.sovereignclaw.xyz`
- Accepts chat messages via `/chat` endpoint or Telegram via `/telegram`
- Reports usage back to `/api/usage/ingest` which deducts credits

---

## Instance State Machine

Every instance has a `status` field that follows strict transitions defined in `src/lib/instance-state.ts`:

```
pending → provisioning → running → stopped → (running again)
                  ↓                    ↓           ↓
          failed_provisioning    deleting ← ← ← ← ←
                  ↓                ↓
              deleting          deleted
                  ↓
               deleted
```

Legal transitions:
| From | Can Go To |
|------|-----------|
| pending | provisioning, failed_provisioning, deleting |
| provisioning | running, failed_provisioning, deleting |
| running | stopped, deleting |
| stopped | running, deleting |
| failed_provisioning | deleting, provisioning (retry) |
| deleting | deleted, failed_provisioning |
| deleted | (terminal) |

All transitions go through `transitionInstance()` which uses `UPDATE ... WHERE status IN (from)` for atomic, race-safe updates. Two concurrent workers trying the same transition — only one succeeds.

---

## The Credit System

Credits are the usage currency. Each plan includes a monthly credit allotment (e.g., Free = 100, Builder = 3,000, Operator = 12,000).

**How credits flow:**
1. **Granted** when a subscription renews (`stripe-events.ts` → `grantCredits()`)
2. **Consumed** when the bot processes requests (`/api/usage/ingest` → `consumeCredits()`)
3. **Cost rules** (in `/api/usage/ingest`):
   - Each request = 1 credit
   - Input tokens = 1 credit per 1,000 tokens
   - Output tokens = 2 credits per 1,000 tokens
4. **When credits hit zero**: The bot is automatically paused (`pauseBot()`)

All credit operations are transactional — `grantCredits()` and `consumeCredits()` use DB transactions with a `CreditLedger` audit trail.

---

## The Bot Runtime (`bot-runtime/`)

This is a separate Node.js application that runs **inside each deployed agent**. It's an Express server with three endpoints:

- `GET /health` — Returns uptime and instance ID
- `POST /chat` — Accepts a message + optional history, returns an AI reply
- `POST /telegram` — Handles Telegram webhook updates

**How chat works** (`bot-runtime/src/chat.ts`):
1. Builds messages: system prompt (SOUL.md) + conversation history + user message
2. Calls OpenRouter API with the primary model (set by budget tier)
3. If primary fails (429/5xx), falls back to the fallback model
4. Reports token usage back to the platform via `reportUsage()`

**Model routing** (`src/lib/model-router.ts`):
| Budget Tier | Primary Model | Fallback |
|-------------|--------------|----------|
| low | Llama 3.2 3B (free) | Gemini 2.0 Flash (free) |
| mid | Gemini 2.0 Flash (free) | Llama 3.2 3B (free) |
| high | Claude 3.5 Sonnet (paid) | Gemini 2.0 Flash (free) |

---

## The Reconciler (`src/lib/reconciler.ts`)

A background worker that cleans up drift between the database and actual cloud infrastructure. It runs six passes:

1. **Orphan sweep** — VMs tagged `sovereignml` in Linode that no DB row owns → delete them
2. **Deleting retries** — Instances stuck in `deleting` whose VM still exists → retry delete
3. **Failed cleanups** — Instances in `failed_provisioning` that still have a VM → delete the VM
4. **Stuck provisioning** — Instances in `provisioning` for >20 minutes → mark failed, delete VM
5. **DB confirmation** — Instances in `deleting` whose VM is actually gone → mark `deleted`
6. **Stamp reconciledAt** — Touch every row that was checked

Triggered via the admin API (`/api/admin/reconcile`).

---

## DNS and Domains

Every VPS agent gets an auto-generated subdomain like `my-bot-bold-hawk.sovereignclaw.xyz`.

**How it works** (`src/lib/agent-dns.ts`):
1. `generateReadableSubdomain()` — Creates `{bot-name-slug}-{adjective}-{noun}` from curated word lists
2. `createAgentSubdomain()` — Calls Cloudflare API to upsert an A record pointing to the VM IP (proxied through Cloudflare)
3. Caddy on the VM serves HTTPS (either with Cloudflare origin certificates or `tls internal` for self-signed)

Users can also bring their own domain — they verify ownership via DNS TXT record (`src/lib/domain-verify.ts`) before the platform provisions the agent.

---

## Authentication

NextAuth v5 with two providers:
- **Credentials** — email + password (bcrypt hashed)
- **Google OAuth** — via `src/lib/google-oauth.ts`

Auth config is split:
- `src/auth.config.ts` — Provider configuration, JWT/session callbacks
- `src/auth.ts` — Drizzle adapter, exports `auth()`, `signIn()`, `signOut()`

The JWT callback enriches the token with `role` (user/admin) and `isBanned`. Banned users are redirected to `/banned`.

---

## Teams

Users can create teams, invite members, and share instances.

- `src/lib/team.ts` — Team creation, membership management
- `src/app/api/team/` — REST endpoints for invites, accept, member management
- Roles: owner, admin, developer, viewer
- Invites sent via Resend email with a token link

---

## Admin Panel

Available at `/admin` for users with `role: "admin"`.

Pages:
- **Dashboard** — Stats summary (users, instances, revenue)
- **Users** — List, ban/unban, reset password, admin notes
- **Instances** — All instances across all users with status filters
- **Subscriptions** — Manage subscriptions, cancel, update
- **Revenue** — Revenue metrics

Admin API endpoints are under `/api/admin/` and require admin role checks.

---

## Database Schema Quick Reference

The 16 tables in `src/db/schema.ts`:

| Table | Purpose |
|-------|---------|
| User | Users with email, role, credits, social links, Stripe customer ID |
| Account | OAuth accounts (NextAuth adapter) |
| Session | Active sessions (NextAuth adapter) |
| VerificationToken | Email verification tokens |
| Plan | Subscription tiers (synced from `configs/plans.ts` via seed) |
| Subscription | Links User → Plan → Instance, tracks Stripe subscription |
| Region | Deployment regions (us-east, etc.) |
| ServerConfig | Server sizes (vCPU, RAM, storage, provider plan) |
| SshKey | User SSH public keys |
| Instance | **The big one** — deployed agents with all state, config, credentials |
| BotHost | Shared Docker hosts in the fleet |
| UsageEvent | Per-request usage tracking from bot runtimes |
| CreditLedger | Append-only credit transaction log |
| InstanceLog | Structured provisioner/lifecycle logs per instance |
| OrphanEvent | Reconciler decisions about orphaned VMs |
| DomainVerification | User domain ownership proofs |
| Team, Membership, TeamInvite | Team collaboration |
| AdminNote | Admin notes on users |

---

## Environment Variables You Need

**Required for production:**
- `DATABASE_URL` — Postgres connection string
- `AUTH_SECRET` — NextAuth secret
- `INSTANCE_ENCRYPTION_KEY` — AES key for encrypting secrets at rest

**For Stripe billing:**
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_*` — Price IDs for each plan/interval

**For real VM provisioning:**
- `LINODE_API_TOKEN` — Linode API access
- `SSH_FLEET_PRIVATE_KEY`, `SSH_FLEET_PUBLIC_KEY` — SSH keypair for fleet access
- `OPENROUTER_PROVISIONING_KEY` — Parent account key used to mint a per-instance OpenRouter runtime key at deploy time and revoke it on delete. The parent key stays on the control plane; only the minted child key lands on the bot VM. Required for new OpenClaw VPS deploys.
- `OPENROUTER_API_KEY` — Legacy shared key. Still used by the shared-cluster `bot-runtime` path and remains the on-disk key for OpenClaw instances that pre-date per-instance minting (until they naturally reprovision).

**For DNS:**
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_BASE_DOMAIN`

**Optional:**
- `LINODE_GOLDEN_IMAGE` — Skip cloud-init bootstrap with a pre-baked image
- `KEEP_FAILED_VMS=true` — Don't delete VMs on provision failure (for debugging)
- `RESEND_API_KEY` — For sending emails
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth

**Dev mode:** Without `LINODE_API_TOKEN`, provisioning is mocked — assigns a fake IP and goes straight to `running`. Without `STRIPE_SECRET_KEY`, billing is skipped and instances auto-activate.

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Set up Postgres
npm run bootstrap:pg

# 3. Push schema to DB
npm run db:push

# 4. Seed plans, regions, server configs
npm run db:seed

# 5. Copy .env.example → .env and fill in values

# 6. Start dev server
npm run dev
```

The app runs at `http://localhost:3000`. In dev mode, everything works without Stripe or Linode — provisioning is mocked and billing is bypassed.

---

## Key Design Decisions

1. **No migration files** — Schema synced via `drizzle-kit push` directly from `schema.ts`. Simple but means no rollback history.

2. **Webhook-driven provisioning** — Stripe `checkout.session.completed` is the trigger for paid plans. The deploy endpoint creates the instance row, Stripe callback provisions it.

3. **Two deployment targets** — "shared" (Docker containers on managed hosts) for lightweight bots, "vps" (dedicated Linode VM with OpenClaw + Caddy + systemd) for full agents.

4. **Advisory locks** — `pg_try_advisory_xact_lock` prevents concurrent provisioning of the same instance, even across multiple Node processes.

5. **Encrypted secrets at rest** — Root passwords, Telegram tokens, gateway tokens, and per-instance OpenRouter runtime keys are AES-encrypted in the DB via `crypto-secret.ts`.

6. **Credits, not metering** — Simpler than real-time metering. Bots report usage, platform deducts credits, bot pauses at zero.

7. **OpenRouter as LLM gateway, per-instance keys** — Each OpenClaw VPS gets its own runtime key minted via OpenRouter's Provisioning API (label `sovereign-<instanceId>`), encrypted at rest in `instances.openRouterKeyEnc`, and revoked on delete. The shared `OPENROUTER_API_KEY` env var is now scoped to the shared-cluster bot-runtime path only. See `src/lib/openrouter-provisioning.ts` and the `getOrMintInstanceOpenRouterKey` helper in `src/lib/provisioner.ts`.

8. **Golden images** — Optional pre-baked Linode images skip the 3-5 minute cloud-init bootstrap, cutting provision time significantly.
