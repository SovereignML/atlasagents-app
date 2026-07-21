# SovereignML Guides

> The complete, in-one-place documentation set: how to configure the platform, how to deploy it from scratch, and how to use it as a customer.

This folder is the source of truth for **environment configuration** and the **clean-install deployment**, plus a full **customer-facing user guide**. It supersedes the split deploy walkthrough that used to live in [DEPLOYMENT.md](../DEPLOYMENT.md) — that file now redirects here for the clean install and keeps the scheduled-jobs + Stripe reference tables.

## Operator guides

| Document | Purpose |
|----------|---------|
| [ENVIRONMENT.md](ENVIRONMENT.md) | **Every** environment variable explained — grouped exactly as in `.env.example`, with what it does, whether it's required, and how to obtain it. The human companion to the machine-readable [`.env.example`](../../.env.example). |
| [DEPLOY-CLEAN.md](DEPLOY-CLEAN.md) | Zero → live on a **clean database**: provision a VPS, bootstrap Postgres, seed, build, run under pm2/systemd, add TLS, and wire cron. The canonical bare-metal walkthrough. |

## User guides (customer-facing)

| Document | Purpose |
|----------|---------|
| [user/README.md](user/README.md) | The user-guide index and reading order. |
| [user/getting-started.md](user/getting-started.md) | Sign up, dashboard tour, first agent in ~5 minutes. |
| [user/deploy-an-agent.md](user/deploy-an-agent.md) | Runtime choice, the 4-step deploy wizard, provisioning. |
| [user/managing-agents.md](user/managing-agents.md) | The agent detail page: credentials, domains, tools, monitoring, backups, sharing. |
| [user/billing-credits.md](user/billing-credits.md) | Credits, wallet, runway, top-ups, plans, invoices. |
| [user/teams.md](user/teams.md) | Invites, roles, seats, SSH keys, integrations. |
| [user/byos.md](user/byos.md) | Bring Your Own Server end-to-end. |
| [user/reseller-whitelabel.md](user/reseller-whitelabel.md) | The white-label reseller panel and setup. |

---

For engineering deep-dives (billing internals, provider router, runtimes), see the [docs index](../README.md).
