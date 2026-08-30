# Atlas Agents documentation

### Start here

| Document | Purpose |
|----------|---------|
| [guides/](guides/README.md) | **Guides folder** — full env-variable reference, the clean-install deploy walkthrough, and the customer-facing user guide |
| [TECH-STACK.md](TECH-STACK.md) | **Canonical** list of frameworks (Next.js, Drizzle, auth, Stripe, etc.), why Drizzle is used instead of Prisma, and legacy **`prisma/`** cleanup |
| [FEATURES.md](FEATURES.md) | Product feature list, routes, plans, regions, compute tiers, and user-visible behavior |
| [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) | How the codebase is organized and where to look when debugging |

### Guides (configure · deploy · use)

| Document | Purpose |
|----------|---------|
| [guides/ENVIRONMENT.md](guides/ENVIRONMENT.md) | Every environment variable explained, grouped, with how-to-obtain — companion to `.env.example` |
| [guides/DEPLOY-CLEAN.md](guides/DEPLOY-CLEAN.md) | Zero → live on a clean database (bare-metal, source of truth for a fresh install) |
| [guides/user/](guides/user/README.md) | Customer-facing user guide: getting started, deploy, manage, billing, teams, BYOS, white-label |

### Feature deep-dives

| Document | Purpose |
|----------|---------|
| [BYOS.md](BYOS.md) | Bring Your Own Server — manage an agent on hardware the customer owns |
| [BILLING.md](BILLING.md) | Credit wallet + OpenRouter margin billing, spend caps, and the usage-sync poller |
| [INTEGRATIONS.md](INTEGRATIONS.md) | User-connected integrations: Google Drive agent backups and BYO Cloudflare domains |
| [PROVIDERS.md](PROVIDERS.md) | Multi-provider VPS router (DigitalOcean / Linode): scoring, failover, budgets |
| [RUNTIMES.md](RUNTIMES.md) | The agent runtimes — OpenClaw and Hermes |
| [HERMES-API-INTEGRATION.md](HERMES-API-INTEGRATION.md) | Connecting external bots to a Hermes instance's OpenAI-compatible `/v1` API |

### Operations

| Document | Purpose |
|----------|---------|
| [guides/DEPLOY-CLEAN.md](guides/DEPLOY-CLEAN.md) | **Clean-install deploy** — the canonical zero-to-live walkthrough |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Operations reference: the **scheduled-jobs** table, **Stripe go-live** checklist, and per-feature config (clean install now lives in `guides/DEPLOY-CLEAN.md`) |
| [BILLING-HARDENING.md](BILLING-HARDENING.md) | Crash-safety, reconciliation, and operability layered on the billing model |
| [SENTRY.md](SENTRY.md) | Error monitoring: what's captured, env vars, source maps, verification |
| [POSTHOG.md](POSTHOG.md) | Product analytics integration (optional, off by default) |
| [AD-CONVERSIONS.md](AD-CONVERSIONS.md) | Server-side Meta / Google ad-conversion tracking |

### History

| Document | Purpose |
|----------|---------|
| [INTERNAL-AUDIT.md](INTERNAL-AUDIT.md) | Historical engineering audit — predates much of the current stack and feature set; cross-check [TECH-STACK.md](TECH-STACK.md) and the deep-dives above |

For a short setup pointer, see the [README](../README.md) in the repo root.
