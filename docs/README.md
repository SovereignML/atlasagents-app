# SovereignML documentation

### Start here

| Document | Purpose |
|----------|---------|
| [TECH-STACK.md](TECH-STACK.md) | **Canonical** list of frameworks (Next.js, Drizzle, auth, Stripe, etc.), why Drizzle is used instead of Prisma, and legacy **`prisma/`** cleanup |
| [FEATURES.md](FEATURES.md) | Product feature list, routes, plans, regions, compute tiers, and user-visible behavior |
| [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) | How the codebase is organized and where to look when debugging |

### Feature deep-dives

| Document | Purpose |
|----------|---------|
| [BYOS.md](BYOS.md) | Bring Your Own Server — manage an agent on hardware the customer owns |
| [BILLING.md](BILLING.md) | Credit wallet + OpenRouter margin billing, spend caps, and the usage-sync poller |
| [INTEGRATIONS.md](INTEGRATIONS.md) | User-connected integrations: Google Drive agent backups and BYO Cloudflare domains |
| [PROVIDERS.md](PROVIDERS.md) | Multi-provider VPS router (Linode / DigitalOcean / OVHcloud): scoring, failover, budgets |
| [RUNTIMES.md](RUNTIMES.md) | The agent runtimes — OpenClaw and Hermes |
| [HERMES-API-INTEGRATION.md](HERMES-API-INTEGRATION.md) | Connecting external bots to a Hermes instance's OpenAI-compatible `/v1` API |

### Operations

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Stand up the control plane: VPS, env, DNS, reverse proxy, scheduled jobs |
| [SENTRY.md](SENTRY.md) | Error monitoring: what's captured, env vars, source maps, verification |

### History

| Document | Purpose |
|----------|---------|
| [INTERNAL-AUDIT.md](INTERNAL-AUDIT.md) | Historical engineering audit — predates much of the current stack and feature set; cross-check [TECH-STACK.md](TECH-STACK.md) and the deep-dives above |

For a short setup pointer, see the [README](../README.md) in the repo root.
