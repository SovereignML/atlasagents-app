# Environment variables — complete reference

> Every environment variable Atlas Agents reads, grouped exactly as they appear in [`.env.example`](../../.env.example), with what each does, whether it's required, and how to obtain it. This is the **human explainer**; [`.env.example`](../../.env.example) is the **canonical machine list** you copy from.

Related: [DEPLOY-CLEAN.md](DEPLOY-CLEAN.md) (the zero-to-live walkthrough that uses these), [BILLING.md](../BILLING.md), [PROVIDERS.md](../PROVIDERS.md), [RUNTIMES.md](../RUNTIMES.md).

---

## How env loading works (read this first)

> **⚠️ One file only: `.env` at the repo root.** Next.js' multi-file layering (`.env.local`, `.env.production`, `.env.production.local`) has caused production incidents and is **banned**: `.gitignore` ignores them, and both [`deploy/pm2.config.cjs`](../../deploy/pm2.config.cjs) and [`scripts/bootstrap-pg.sh`](../../scripts/bootstrap-pg.sh) **refuse to start** if any of them exist on disk. Need a different value on a box? Edit that box's `.env`. Never create a second env file.

Rules of the road:

- **Copy the template:** `cp .env.example .env`, then fill in values. Keep the two files' **keys, order, and section headers identical** — only the values differ.
- **`NEXT_PUBLIC_*` vars are inlined at build time.** They must be present in the **build** environment, not just at runtime, or the browser bundle bakes in an empty value. Rebuild after changing one.
- **Commented-out vars** (`# KEY=`) fall back to a built-in default in code. Leaving a bare `KEY=` overrides that default with an empty string — so keep optional overrides commented unless you mean to set them.
- **Secrets live in env, never in the DB.** The only exceptions are credentials entered through the admin UI (Cloudflare R2 backup creds, per-provider budgets), which are stored **encrypted** in the database.

**Production boot gate.** When `NODE_ENV=production`, [`assertBillingConfig`](../../src/lib/billing-config.ts) refuses to start the server unless the required billing pieces are present (valid `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, a non-localhost `https` `NEXT_PUBLIC_APP_URL`, and the cron tokens). In dev these are optional and the app auto-grants/auto-provisions for free.

**Legend for the "Required?" column:** **Prod** = required to boot or operate in production · **Feature** = only needed to turn a specific feature on · **Optional** = has a safe default or is dev-only.

---

## 1. Database

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `DATABASE_URL` | **Prod** | Postgres connection string used by Drizzle (`src/db/index.ts`). Prod tip: append `&connection_limit=10&pool_timeout=30`. | Written automatically by [`scripts/bootstrap-pg.sh`](../../scripts/bootstrap-pg.sh); or hand-write `postgresql://user:pass@host:5432/dbname`. |
| `POSTGRES_USER` | Optional | DB role name — consumed by Docker Compose to init the DB container. Keep consistent with `DATABASE_URL`. | You choose (default `sovereignml`). |
| `POSTGRES_PASSWORD` | Optional | DB password for the Compose-initialized container. | `openssl rand -base64 24 \| tr -d '/+=' \| cut -c1-24` |
| `POSTGRES_DB` | Optional | Database name for the Compose container. | You choose (default `sovereignml`). |

> On the supported bare-metal path, `bootstrap-pg.sh` creates the role/db and writes `DATABASE_URL` for you — the `POSTGRES_*` trio only matters if you run Postgres via Docker Compose.

## 2. App / Server

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NEXT_PUBLIC_APP_URL` | **Prod** | Public base URL of the app — used for OAuth callbacks, emails, Stripe redirects. **Must be a non-localhost `https://` URL in production** or the boot gate fails. | Your domain, e.g. `https://app.atlasagents.dev`. |
| `PORT` | Optional | Port the Next.js server listens on. The reverse proxy and `cron-tick.sh` assume this. | Default `3000`. |
| `HOSTNAME` | Optional | Interface the server binds to. pm2/systemd set `0.0.0.0`. | Default `127.0.0.1` (dev). |

## 3. White-label custom dashboard domains

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `WHITELABEL_CNAME_TARGET` | Feature | CNAME target shown to teams connecting a custom dashboard domain (Cloudflare for SaaS custom-hostname target). Defaults to the `NEXT_PUBLIC_APP_URL` host. | The SaaS custom-hostname target from your Cloudflare-for-SaaS zone. See [deploy/README.md §10](../../deploy/README.md). |
| `WHITELABEL_FALLBACK_ORIGIN` | Feature | Cloudflare-for-SaaS **fallback origin** pointing at the app server (used when serving tenant custom hostnames). | Your app origin host; configured alongside Cloudflare for SaaS. |

## 4. NextAuth

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NEXTAUTH_URL` | **Prod** | Canonical URL NextAuth uses to build OAuth callback URLs. | Same as `NEXT_PUBLIC_APP_URL`. |
| `NEXTAUTH_SECRET` | **Prod** | Session/JWT encryption secret. | `openssl rand -base64 32` |
| `AUTH_SECRET` | **Prod** | Alias read interchangeably with `NEXTAUTH_SECRET` — **keep them equal**. | Same value as `NEXTAUTH_SECRET`. |
| `AUTH_TRUST_HOST` | **Prod** | Trust the incoming host header (needed behind a proxy). | Set `true` in prod. |

## 5. Google OAuth + Drive backups

Same client powers Google sign-in **and** per-user Google Drive backups (scope `drive.file`).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `GOOGLE_CLIENT_ID` | Feature | Google OAuth client id (sign-in + Drive backups). Aliases: `AUTH_GOOGLE_ID`. | [Google Cloud Console](https://console.cloud.google.com) → Credentials → OAuth client. |
| `GOOGLE_CLIENT_SECRET` | Feature | Google OAuth client secret. Aliases: `AUTH_GOOGLE_SECRET`. | Same OAuth client. |
| `GOOGLE_DRIVE_REDIRECT_URI` | Optional | Override for the Drive callback. Defaults to `<NEXT_PUBLIC_APP_URL>/api/integrations/drive/callback`. | Add this URI as an Authorized redirect URI, plus the `.../auth/drive.file` scope on the consent screen. |

## 6. X / Twitter OAuth

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `TWITTER_CLIENT_ID` | Feature | OAuth 2.0 client id for X sign-in. Aliases: `AUTH_TWITTER_ID`. | [X Developer Portal](https://developer.x.com/en/portal/dashboard). |
| `TWITTER_CLIENT_SECRET` | Feature | OAuth 2.0 client secret. Aliases: `AUTH_TWITTER_SECRET`. | Same app. |

## 7. Apple OAuth

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `APPLE_CLIENT_ID` | Feature | Apple Service ID. Aliases: `AUTH_APPLE_ID`. | Apple Developer account. |
| `APPLE_CLIENT_SECRET` | Feature | A JWT client secret. Aliases: `AUTH_APPLE_SECRET`. | `npx auth add apple`, or per Apple's "Creating a Client Secret" docs. |

## 8. Stripe

> **In production these are required** — with `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` blank, the boot gate fails and every paid endpoint (top-up, deploy, BYOS) returns 503. See the [Stripe go-live checklist](../DEPLOYMENT.md#stripe-go-live-checklist).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `STRIPE_SECRET_KEY` | **Prod** | Stripe API secret key. | Stripe Dashboard → Developers → API keys (`sk_live_…`). |
| `STRIPE_WEBHOOK_SECRET` | **Prod** | Signing secret for the main webhook (`/api/webhooks/stripe`). | Stripe Dashboard → Webhooks → your endpoint (`whsec_…`). |
| `STRIPE_PRICE_{FREE,LITE,BUILDER,OPERATOR,SCALE,ENTERPRISE,BYOS}_{MONTHLY,YEARLY}` | Feature | Per-tier Stripe price IDs (14 vars). Names **must** match `src/configs/plans.ts`. Currently informational — Checkout builds inline `price_data` — but set them for clean reporting/tax. | Create products + prices in Stripe; copy each `price_…` id. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Feature | Separate signing secret for Stripe **Connect** (reseller / connected-account events at `/api/webhooks/stripe-connect`). Only for white-label reseller billing. | Stripe Connect webhook endpoint's signing secret. |

## 9. Email (Resend)

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `RESEND_API_KEY` | Feature | API key for transactional email (password reset, verification, invites). Without it those flows no-op. | [resend.com](https://resend.com) → API Keys. |
| `RESEND_FROM_EMAIL` | Feature | The `From:` address. Domain must be verified in Resend. | e.g. `noreply@atlasagents.dev`. |

## 10. Notifications — Telegram bot

A **dedicated** bot that sends users their notifications (not a user's deployed bot; those route at `/tg/[botToken]`). Discord/Slack need no env — users paste per-account webhook URLs.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NOTIFY_TELEGRAM_BOT_TOKEN` | Feature | Bot token for the notification bot. | [@BotFather](https://t.me/BotFather). |
| `NOTIFY_TELEGRAM_BOT_USERNAME` | Feature | Bot username (no `@`) for the `t.me` deep link. | From BotFather. |
| `NOTIFY_TELEGRAM_WEBHOOK_SECRET` | Feature | Verifies the `X-Telegram-Bot-Api-Secret-Token` header. Register once via the `setWebhook` curl in `.env.example`. | `openssl rand -hex 32` |

## 11. Chatwoot support

Live-chat widget + in-app support tickets. The two `NEXT_PUBLIC_` vars drive the browser widget; the rest are server-only for ticket creation.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NEXT_PUBLIC_CHATWOOT_BASE_URL` | Feature | Your Chatwoot base URL (no trailing slash). | e.g. `https://chat.atlasagents.dev`. |
| `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` | Feature | Website-channel token (public) that drives the chat bubble. | Chatwoot → Inboxes → Website widget. |
| `CHATWOOT_HMAC_TOKEN` | Optional | Enables widget identity verification. | Chatwoot inbox settings. |
| `CHATWOOT_API_ACCESS_TOKEN` | Feature | Agent/bot API access token (server only), used to create tickets. | Chatwoot → Profile → Access token. |
| `CHATWOOT_ACCOUNT_ID` | Feature | Numeric Chatwoot account id. | From the Chatwoot URL/settings. |
| `CHATWOOT_INBOX_ID` | Feature | Numeric inbox id tickets are created in. **Must be an API inbox** (`Channel::Api`), not the website-widget inbox. | Create an API inbox in Chatwoot. |

## 12. Instance encryption

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `INSTANCE_ENCRYPTION_KEY` | **Prod** | 32-byte base64 key encrypting per-instance secrets at rest (root/admin passwords, Drive refresh tokens, BYOS/own LLM keys). | `openssl rand -base64 32`. **Losing/rotating it makes existing encrypted secrets unrecoverable.** |

## 13. Bot Factory — OpenRouter (LLM provider)

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `OPENROUTER_API_KEY` | Feature | Legacy **shared** key — used by the shared-cluster bot path and as a fallback for pre-minting OpenClaw instances. | [openrouter.ai/keys](https://openrouter.ai/keys). |
| `OPENROUTER_PROVISIONING_KEY` | **Prod** (for OpenClaw VPS deploys) | Parent key that **mints a per-instance runtime key** at deploy time and revokes it on delete. The parent never lands on a bot VM. Without it, new OpenClaw VPS deploys **fail hard** rather than fall back to the shared key. | [openrouter.ai/settings/provisioning-keys](https://openrouter.ai/settings/provisioning-keys). |
| `OPENROUTER_MARGIN` | Optional | Gross-margin fraction. Each per-instance key is capped at `(lifetime credits funded × this)` USD, so OpenRouter can't bill more than this share of revenue. `0.9` = 10% margin. Range `(0,1]`. | Default `0.9`. |
| `ANOMALY_USD_PER_INTERVAL` | Optional | A single usage-sync interval's OpenRouter spend above this (USD) is treated as abuse: disable key + pause + alert. | Default `50`. |

> If you run with **NVIDIA as the default provider** (see §15), OpenRouter becomes optional — the platform can run with zero OpenRouter dependency.

## 14. Bot Factory — NVIDIA fallback provider

Direct OpenAI-compatible fallback (`https://integrate.api.nvidia.com/v1`). Either key reaches the full catalog; two just spread load over two free-tier pools.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NVIDIA_API_KEY` | Feature | Legacy single key — back-compat fallback when the slot keys are unset. | [build.nvidia.com](https://build.nvidia.com/). |
| `NVIDIA_API_KEY_PRIMARY` | Feature | Per-slot key for the admin Models panel; pairs with `mistralai/mistral-medium-3.5-128b`. | Same. |
| `NVIDIA_API_KEY_SECONDARY` | Feature | Per-slot key; pairs with `z-ai/glm-5.1`. | Same. |

## 15. LLM default provider

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `LLM_DEFAULT_PROVIDER` | Optional | Platform-wide default: `openrouter` (default) or `nvidia`. `nvidia` provisions bots directly against NVIDIA (no OpenRouter needed). Overridable per instance via `instances.llmProvider`. | Default `openrouter`. |
| `HERMES_MODEL` | Optional | Override the default Hermes model id. | Leave commented to use the code default. |

## 16. Bot Factory — VPS provider router

The router scores/fails over across enabled providers, reading the **DB** at runtime (seeded from `src/configs/providers.ts`). Only providers with credentials are routed to. See [PROVIDERS.md](../PROVIDERS.md).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `VM_PROVIDER` | Optional | Default provider for **legacy/fallback paths only** — the router itself ranks by DB priority. | `digitalocean` or `linode`. |
| `DIGITALOCEAN_API_TOKEN` | **Prod** (primary provider) | DigitalOcean API token — **DigitalOcean is the primary active provider** (router priority 100). DO has no root-password API: access is via the SSH fleet key, auto-registered as `sovereign-fleet`. | [DO API tokens](https://cloud.digitalocean.com/account/api/tokens), scope **write**. |
| `LINODE_API_TOKEN` | Feature | Linode / Akamai token — **failover** provider (priority 90), retained for future use. | [Linode tokens](https://cloud.linode.com/profile/tokens), scopes `linodes:read_write`, `stackscripts:read_write`. |
| `LINODE_GOLDEN_IMAGE` | Optional | Pre-baked image id to skip cold provisioning on Linode. | From `scripts/bake-golden-image.ts` output. |

> **Note on the `.env.example` comment drift:** older comments in `.env.example` call Linode the primary and default `VM_PROVIDER="linode"`. The **code is the source of truth** ([`src/configs/providers.ts`](../../src/configs/providers.ts), [PROVIDERS.md](../PROVIDERS.md)): **DigitalOcean is priority 100 (primary), Linode 90 (failover)**. Set `VM_PROVIDER=digitalocean` for new deploys. Align the warm-pool `POOL_*` vars (§21) to whichever provider actually serves your deploys.

## 17. Bot Factory — SSH fleet key

Ed25519 keypair used to SSH into provisioned VMs.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `SSH_FLEET_PRIVATE_KEY` | **Prod** | Private key (often base64-encoded into a single line) the platform uses to reach every VM it provisions. Lives in env only. | `ssh-keygen -t ed25519 -f ./sovereign_fleet -N ""` then `base64 -w0 sovereign_fleet`. |
| `SSH_FLEET_PUBLIC_KEY` | **Prod** | The matching public key, auto-registered with providers and installed on each VM. Also the key BYOS users paste into `authorized_keys`. | `cat sovereign_fleet.pub`. Delete the local files after copying into env. |

## 18. Bot Factory — Runtime images + version pins

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `BOT_RUNTIME_IMAGE` | Optional | Docker image for the bot runtime (built by `.github/workflows/bot-runtime.yml`). | Default `ghcr.io/sovereignml/sovereign-bot-runtime:latest`. |
| `OPENCLAW_VERSION` | Optional | Override the OpenClaw version new boxes install. Unset = the code pin (`OPENCLAW_PINNED_VERSION`, one behind upstream). `latest` tracks upstream. | A tested version — or leave unset. |
| `HERMES_VERSION` | Optional | Override the hermes-agent version. Unset = `HERMES_PINNED_VERSION`. | Same. |
| `OPEN_WEBUI_VERSION` | Optional | Override the Open WebUI (Hermes chat UI) version. Unset = `OPEN_WEBUI_PINNED_VERSION`. | Same. |
| `CADDY_VERSION` | Optional | Override the Caddy release installed from GitHub (not an apt repo). Unset = `CADDY_DEFAULT_VERSION`. A plain release number, e.g. `2.11.7`. | Same. |
| `RUNTIME_MIN_NODE` | Optional | Minimum Node version enforced on runtime images. | Code default. |

## 18a. Bot Factory — Gateway, orchestrator, Telegram dev tunnel

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NEXT_PUBLIC_GATEWAY_BASE_URL` | Feature | Public bot-gateway URL. In dev, your dev server; in prod, the real URL. | Your domain (build-time inlined). |
| `OPENCLAW_ORCHESTRATOR_URL` | Optional | External orchestrator URL. Leave unset to use the built-in SSH provisioner. | Only if self-hosting an orchestrator. |
| `TELEGRAM_DEV_PUBLIC_URL` | Optional (dev) | Public HTTPS URL (e.g. ngrok) so Telegram webhooks register in dev. If unset, interface binding saves the token but skips webhook setup. | An ngrok/tunnel URL. |

## 19. Cloudflare (DNS / SSL / origin certs)

Check the whole block with `node --env-file=.env --import tsx scripts/check-agent-zones.ts --live` (read-only; prints no secrets).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `CLOUDFLARE_API_TOKEN` | Feature | Automatic proxied `A` records for managed agent hostnames + custom-hostname management. | Cloudflare token with **Zone:DNS:Edit** + **Zone:SSL:Edit** (add SSL/Certificates:Edit for SaaS) on **every agent zone** (legacy and new). |
| `CLOUDFLARE_ZONE_ID` | Feature | Zone id of the **legacy agent zone** (`sovereignclaw.xyz`), which keeps serving every agent created in it after a zone move. Also the fallback for `CLOUDFLARE_SAAS_ZONE_ID` — do not repoint it at a new zone. | Cloudflare dashboard → your zone → Overview. |
| `CLOUDFLARE_SAAS_ZONE_ID` | Feature | SaaS-enabled zone for white-label custom hostnames. Falls back to `CLOUDFLARE_ZONE_ID`. | Your Cloudflare-for-SaaS zone id. |
| `CLOUDFLARE_BASE_DOMAIN` | Feature | Domain of the legacy agent zone. Defaults to `sovereignclaw.xyz`. Do not repoint it (or `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_ORIGIN_CERT_*`) at a new zone while agents still live in the old one — use `CLOUDFLARE_AGENT_*`. | Leave unset. |
| `CLOUDFLARE_FALLBACK_IP` | Optional | Wildcard landing host IP for `scripts/cloudflare-bootstrap.ts`; unset = no wildcard record, unknown subdomains stay NXDOMAIN. The host needs the zone's origin cert, or the wildcard is a 526. | Your app server IP. |
| `CLOUDFLARE_ORIGIN_CERT_PEM` | Optional | Origin CA cert (PEM) for `*.<legacy zone>`, installed over SSH on each box when an agent is configured (enables Cloudflare **Full (strict)**). Provisioning refuses a cert that does not cover the zone, a key that is not its key, or an expired cert. | Cloudflare → the legacy zone → SSL/TLS → Origin Server → Create Certificate. |
| `CLOUDFLARE_ORIGIN_CERT_KEY` | Optional | Matching origin CA private key (PEM). | Same as above. |
| `CLOUDFLARE_AGENT_DOMAIN` | Optional | Domain of the **new agent zone**. With `CLOUDFLARE_AGENT_ZONE_ID` also set, new agents get `<name>.<this domain>`; existing agents keep their hostnames. Unset = no zone move. | A domain you own, on Cloudflare (`atlasdeploy.xyz`). |
| `CLOUDFLARE_AGENT_ZONE_ID` | Optional | Zone id of the new agent zone. Required together with `CLOUDFLARE_AGENT_DOMAIN`. | Cloudflare dashboard → the new zone → Overview. |
| `CLOUDFLARE_AGENT_ORIGIN_CERT_PEM` | Optional | Origin CA cert for `*.<new agent domain>` (needed for Full (strict) there). | Cloudflare → the **new** zone → SSL/TLS → Origin Server → Create Certificate. |
| `CLOUDFLARE_AGENT_ORIGIN_CERT_KEY` | Optional | Matching private key. | Same as above. |

## 20. Cloudflare Turnstile (bot protection)

Anti-bot challenge on register / login / forgot-password. **Both must be set to enable**; leave both unset to disable.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Feature | Public site key rendered in the widget. | [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile). |
| `TURNSTILE_SECRET_KEY` | Feature | Server-side verification secret. | Same. |

## 21. Sentry error monitoring

Leave DSNs unset to disable entirely. See [SENTRY.md](../SENTRY.md).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `SENTRY_DSN` | Optional | Server-side DSN. | [sentry.io](https://sentry.io) → Next.js project. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Browser + edge (middleware) DSN. | Same project. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Optional | Build-time source-map upload only — safe to omit. | Sentry org/project settings + auth token. |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | Trace sampling rate. | Default `0.1`. |

## 22. PostHog product analytics

Leave `NEXT_PUBLIC_POSTHOG_KEY` unset to disable. Inlined at **build** time. See [POSTHOG.md](../POSTHOG.md).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional | Project API key (`phc_…`) enabling client analytics, replay, flags. | [us.posthog.com](https://us.posthog.com) project settings. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional | Reverse-proxy path so ad-blockers don't drop events. | Default `/ingest`. |
| `POSTHOG_KEY` | Optional | Server SDK key (falls back to the public key). | Same project. |
| `POSTHOG_HOST` | Optional | Server SDK host (talks direct, no proxy). | Default `https://us.i.posthog.com`. |

## 23. Ad-conversion tracking (Meta + Google)

Server-side conversion tracking, independent per platform, no-op until set, and only fires with marketing consent. See [AD-CONVERSIONS.md](../AD-CONVERSIONS.md).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `META_PIXEL_ID` | Optional | Numeric Meta pixel (dataset) id. | Meta Events Manager. |
| `META_CAPI_ACCESS_TOKEN` | Optional | System-user token for the pixel (Conversions API). | Events Manager → Settings → Conversions API. |
| `META_GRAPH_API_VERSION` | Optional | Pin the Graph API version. | Default `v21.0`. |
| `META_CAPI_TEST_EVENT_CODE` | Optional | Routes to Test Events while validating. | Events Manager → Test Events. |
| `GOOGLE_DM_SERVICE_ACCOUNT_JSON` | Optional | Service-account key JSON (raw or base64) with the Data Manager scope. | Google Cloud service account, linked in Google Ads. |
| `GOOGLE_ADS_CUSTOMER_ID` | Optional | Operating account id, digits only. | Google Ads. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Optional | Manager (MCC) id if auth goes through one. | Google Ads MCC. |
| `GOOGLE_DM_SIGNUP_DESTINATION_ID` | Optional | Conversion-action id for signups. | Google Ads conversion action. |
| `GOOGLE_DM_PURCHASE_DESTINATION_ID` | Optional | Conversion-action id for purchases. | Google Ads conversion action. |

## 24. Uptime monitoring (Uptime Kuma)

Per-instance uptime monitors. `BASE_URL` + `API_KEY` enable read-only `/metrics`; `USERNAME`/`PASSWORD` enable Socket.io writes. Leave all unset to disable.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `UPTIME_KUMA_BASE_URL` | Feature | Your Kuma URL (no trailing slash). | e.g. `https://uptime.atlasagents.dev`. |
| `UPTIME_KUMA_USERNAME` | Feature | Service account for Socket.io writes (create/edit/delete monitors). **Must not have 2FA.** | Kuma admin account. |
| `UPTIME_KUMA_PASSWORD` | Feature | Password paired with the username. | Kuma. |
| `UPTIME_KUMA_API_KEY` | Feature | HTTP Basic password for the `/metrics` scrape. | Kuma → Settings → API Keys. |
| `UPTIME_KUMA_INSECURE_TLS` | Optional | Allow self-signed TLS on the Kuma host. | Set `true` if needed. |

## 25. Cron & job auth tokens

Bearer tokens guarding cron/job endpoints (`Authorization: Bearer <token>`). Generate each with `openssl rand -hex 32`. The full endpoint/cadence/purpose table is the canonical reference in [DEPLOYMENT.md → Scheduled jobs](../DEPLOYMENT.md#scheduled-jobs); [DEPLOY-CLEAN.md §12](DEPLOY-CLEAN.md) wires them.

| Variable | Guards endpoint | Cadence |
|----------|-----------------|---------|
| `USAGE_SYNC_CRON_TOKEN` | `POST /api/billing/usage-sync` | ~10 min |
| `BILLING_CRON_TOKEN` | `POST /api/billing/daily` | daily |
| `CREDIT_EXPIRY_CRON_TOKEN` | `POST /api/billing/expire-credits` | daily |
| `RECONCILE_CRON_TOKEN` | `POST /api/admin/reconcile` (also provider health/budget sync) | daily |
| `BACKUP_CRON_TOKEN` | `POST /api/admin/backups/cron` | nightly |
| `UPTIME_SYNC_CRON_TOKEN` | `POST /api/internal/uptime-sync` | ~1–2 min |
| `METRICS_COLLECT_CRON_TOKEN` | `POST /api/internal/metrics-collect` | ~1–2 min |
| `ALERTS_EVAL_CRON_TOKEN` | `POST /api/internal/alerts-eval` | ~5–10 min |
| `DEMO_REAP_CRON_TOKEN` | `POST /api/internal/demo-reap` | ~1 min |
| `AUDIT_RETENTION_CRON_TOKEN` | `POST /api/audit-log/prune` | daily |
| `EVENTS_RETENTION_CRON_TOKEN` | `POST /api/internal/events-prune` | daily |
| `ADMIN_NOTIFICATION_RETENTION_CRON_TOKEN` | `POST /api/admin/notifications/prune` | daily |
| `POOL_REFILL_CRON_TOKEN` | `POST /api/internal/pool-refill` | **optional** (pool self-refills in-process) |

## 26. Warm VM pool

Pre-booted, pre-URL'd VMs kept ready so a deploy can **claim** one and skip cold install (sub-25s delivery). This is the **primary** managed-VPS delivery path and is **on by default** whenever a provider token + `SSH_FLEET_PRIVATE_KEY` are present; without creds it stays off (dev never spins up billable VMs). Idle VMs bill continuously (~$120/mo for the default 3 Hermes + 2 OpenClaw at a 4 GB class).

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `POOL_ENABLED` | Optional | Set `false` to disable the pool entirely; blank = auto-on when creds present. | Leave blank, or `false`. |
| `POOL_SIZE_HERMES` | Optional | Target ready Hermes VMs. | Default `2`. |
| `POOL_SIZE_OPENCLAW` | Optional | Target ready OpenClaw VMs. `0` disables the OpenClaw pool. | Default `1`. |
| `POOL_REFILL_INTERVAL_MS` | Optional | In-process refill cadence (ms). | Default `60000`. |
| `POOL_PROVIDER_SLUG` | Optional | Provider the pool warms — **must match where deploys route** or claims miss. | Align to your primary provider (e.g. `digitalocean`). |
| `POOL_PLAN_CODE` | Optional | Provider plan code the pool warms. | Must match the deploy plan/region. |
| `POOL_REGION_CODE` | Optional | Provider region the pool warms. | Must match the deploy region. |
| `EVENTS_RETENTION_DAYS` | Optional | How long `AgentEvent` rows are kept before `events-prune` deletes them. | Default `30`. |

## 27. Billing tuning (optional overrides)

| Variable | Required? | What it does | Default |
|----------|-----------|--------------|---------|
| `BILLING_DRIFT_USD` | Optional | USD gap vs OpenRouter spend before flagging drift. | `1` |
| `BILLING_RECONCILE_MAX_KEYS` | Optional | Max OpenRouter key polls per reconcile run. | `250` |
| `LOW_BALANCE_WARN_MULTIPLIER` | Optional | Warn at this × the wallet minimum balance. | `2` |

## 28. Admin database backups (Cloudflare R2)

> The R2 credentials themselves are entered in the admin UI (`/admin/backups`) and stored **encrypted in the DB** — they are **not** env vars. The only server-side requirement is a `postgresql-client` (`pg_dump`/`pg_restore`) whose major version ≥ the Postgres server version.

| Variable | Required? | What it does | How to obtain / generate |
|----------|-----------|--------------|--------------------------|
| `PG_DUMP_PATH` | Optional | Absolute path to `pg_dump` if not on `PATH`. | Default `pg_dump`. |
| `PG_RESTORE_PATH` | Optional | Absolute path to `pg_restore` if not on `PATH`. | Default `pg_restore`. |

## 29. Advanced / dev-only

| Variable | Required? | What it does | Notes |
|----------|-----------|--------------|-------|
| `NODE_ENV` | Optional | `development` / `production`. Gates the billing boot check and dev auto-grant. | Usually set by the framework/process manager. |
| `KEEP_FAILED_VMS` | Optional (debug) | Keep VMs that fail provisioning so you can SSH in and inspect. | Remove/`false` for normal operation (failed VMs are deleted to avoid cost). |
| `SKIP_OPENCLAW_ONBOARD` | Optional (dev) | Skip OpenClaw onboarding during db seed. | Dev only. |
| `BYOS_HOST_ALLOWLIST` | Optional | Comma-separated hosts allowed past the SSRF guard for BYOS SSH targets. | Only if BYOS targets are blocked by the guard. |
| `ADMIN_EMAIL` | Optional | First admin account email (seed + `make-admin`). | Default `admin@sovereignml.com`. |
| `ADMIN_PASSWORD` | **Prod** (to seed admin) | First admin password. In production the **seed refuses to create the admin without this** (no weak default) — or run `npm run make-admin` interactively. | Set your own strong value. |
| `BAKE_REGION` / `BAKE_PLAN` | Optional | Linode region/plan for `scripts/bake-golden-image.ts`. | Script inputs. |
| `TEST_USER_ID` | Optional | User id for `scripts/test-wallet-race.ts`. | Script input. |

### Seed/deploy control flags

These aren't in `.env.example` but are read by the bootstrap/seed flow:

| Variable | What it does |
|----------|--------------|
| `DB_SEED=1` | Makes [`scripts/bootstrap-pg.sh`](../../scripts/bootstrap-pg.sh) also run the seed after schema push. |
| `SEED_ON_BOOT=true` | Runs the seed on server boot (turn back off after the first successful boot). |

---

## Minimum-viable production set

To boot a real production control plane you need, at minimum:

```dotenv
# Core
DATABASE_URL=...                     # written by bootstrap-pg.sh
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXTAUTH_URL=https://app.example.com
NEXTAUTH_SECRET=...                  # = AUTH_SECRET
AUTH_SECRET=...
AUTH_TRUST_HOST=true
INSTANCE_ENCRYPTION_KEY=...          # openssl rand -base64 32

# Billing (required in prod — boot gate)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# LLM + provisioning
OPENROUTER_PROVISIONING_KEY=sk-or-prov-...
DIGITALOCEAN_API_TOKEN=...           # primary provider
SSH_FLEET_PRIVATE_KEY=...            # base64 ed25519
SSH_FLEET_PUBLIC_KEY=ssh-ed25519 ...

# Cron auth (required in prod)
BILLING_CRON_TOKEN=...
RECONCILE_CRON_TOKEN=...
USAGE_SYNC_CRON_TOKEN=...
BACKUP_CRON_TOKEN=...
```

Everything else is feature-gated — add the section you need. Follow [DEPLOY-CLEAN.md](DEPLOY-CLEAN.md) to put it all together.
