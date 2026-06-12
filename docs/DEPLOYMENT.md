# SovereignML deployment guide (for dummies)

End-to-end: from fresh VPS → public HTTPS URL → one-click OpenClaw deploys working.

> **⚠️ Docker files not yet in the repo.** Steps 4, 7–9 below describe a `docker compose` flow, but the repo currently ships no `Dockerfile`/`docker-compose.yml`. The supported deploy path today is the **bare-metal pm2/systemd setup in [`deploy/README.md`](../deploy/README.md)** — use that, and treat the env-var/cron/Stripe sections of this guide as the reference for configuration.

---

## 0. What you need before you start

- A VPS (Ubuntu 22.04+ recommended, 2 vCPU / 4 GB RAM minimum).
- A domain you control (e.g. `sovereignml.example.com`) with DNS access.
- A **Linode** API token — [create one here](https://cloud.linode.com/profile/tokens) with scopes `linodes:read_write` + `stackscripts:read_write`. This is what the platform uses to spin up user VMs.
- An **OpenRouter** API key — [get one here](https://openrouter.ai/keys). Powers OpenClaw's LLM calls.
- *(Optional in dev / **required in production**)* Stripe keys for real billing. Leave blank for dev mode (auto-activates instances, skips payment). **Dev mode is disabled when `NODE_ENV=production`** — a production build with blank Stripe keys fails config validation at boot, and every paid endpoint returns 503. See the [Stripe go-live checklist](#stripe-go-live-checklist) before launching.
- *(Optional)* Google OAuth credentials if you want Google sign-in.

---

## 1. SSH into the VPS and install Docker

```bash
ssh root@YOUR_VPS_IP

# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin git

# Firewall
ufw allow 22,80,443/tcp
ufw --force enable
```

---

## 2. Clone the repo

```bash
cd /opt
git clone https://github.com/YOUR_ORG/redesigned-giggle.git sovereignml
cd sovereignml
```

---

## 3. Generate the secrets you'll need

Run these on the VPS and copy the output — you'll paste them into `.env.production` in the next step.

```bash
# NextAuth session secret
openssl rand -base64 32

# Instance encryption key (used for root passwords / OpenClaw admin passwords at rest)
openssl rand -base64 32

# Postgres password
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24

# SSH fleet key (the platform uses this to SSH into the VPSes it provisions for users)
ssh-keygen -t ed25519 -f /tmp/sovereign_fleet -N ""
echo "---PRIVATE (base64)---"
base64 -w0 /tmp/sovereign_fleet; echo
echo "---PUBLIC---"
cat /tmp/sovereign_fleet.pub
rm /tmp/sovereign_fleet /tmp/sovereign_fleet.pub
```

---

## 4. Create your env file

> **Env-file convention.** [`.env.example`](../.env.example) is the canonical list of every variable. This Docker guide copies it to `.env.production`; the bare-metal guide ([`deploy/README.md`](../deploy/README.md)) uses a single `.env`. Use whichever file your process manager / compose actually loads — the variable names are the same. When in doubt, `.env.example` is the source of truth.

```bash
cp .env.example .env.production
nano .env.production
```

Fill in, at minimum:

```dotenv
# --- Postgres (used by docker-compose) ---
POSTGRES_USER=sovereignml
POSTGRES_PASSWORD=<paste generated postgres password>
POSTGRES_DB=sovereignml

# --- Auth ---
NEXTAUTH_URL=https://sovereignml.example.com
NEXTAUTH_SECRET=<paste generated NextAuth secret>
AUTH_TRUST_HOST=true

# --- App URLs ---
NEXT_PUBLIC_APP_URL=https://sovereignml.example.com
NEXT_PUBLIC_GATEWAY_BASE_URL=https://sovereignml.example.com

# --- Encryption ---
INSTANCE_ENCRYPTION_KEY=<paste generated encryption key>

# --- Agent deploys: OpenRouter + Linode + SSH fleet ---
# OPENROUTER_PROVISIONING_KEY is the parent account key with provisioning
# scope. Each OpenClaw VPS deploy mints its own runtime key under it, so
# the parent key never leaves the control plane. Create one at
# https://openrouter.ai/settings/provisioning-keys
OPENROUTER_PROVISIONING_KEY=sk-or-prov-...
# OPENROUTER_API_KEY is the legacy shared key — still required for the
# shared-cluster bot-runtime path and as the fallback baked into in-place
# OpenClaw instances that pre-date per-instance key minting.
OPENROUTER_API_KEY=sk-or-v1-...
LINODE_API_TOKEN=...
SSH_FLEET_PRIVATE_KEY="<paste the base64 private key>"
SSH_FLEET_PUBLIC_KEY="ssh-ed25519 AAAA... sovereignml-fleet"

# --- Optional: leave blank for dev-mode (no billing, auto-activate) ---
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# --- First-boot seed: regions, server configs, plans ---
SEED_ON_BOOT=true
```

> **Leave `DATABASE_URL` blank / commented** — docker-compose writes the correct one automatically pointing at the `postgres` service.

---

## 5. Point DNS at the VPS

At your DNS provider, create:

| Type | Name                   | Value         |
| ---- | ---------------------- | ------------- |
| A    | sovereignml.example.com | YOUR_VPS_IP   |

Wait 1–2 minutes for propagation (`dig +short sovereignml.example.com` should return your IP).

---

## 6. Put a reverse proxy in front (Caddy — the easy option)

Caddy handles Let's Encrypt automatically.

```bash
apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
sovereignml.example.com {
  reverse_proxy 127.0.0.1:3002
}
EOF
systemctl restart caddy
```

That's it — Caddy will fetch a TLS cert within seconds.

*(If you prefer Nginx + certbot, proxy `127.0.0.1:3002` the same way. If you use Cloudflare Tunnel, point the tunnel at `http://127.0.0.1:3002`.)*

---

## 7. Launch the stack

```bash
docker compose up -d --build
```

First build takes 3–5 minutes. Watch progress:

```bash
docker compose logs -f app
```

You want to see:
- Schema applied via **Drizzle** (e.g. `drizzle-kit push` or your image entrypoint equivalent) — **not** `prisma migrate deploy` (this app uses [TECH-STACK.md](TECH-STACK.md) Drizzle + `src/db/schema.ts`)
- (if `SEED_ON_BOOT=true`) `Seeded N regions / M server configs / plans`
- `Ready on http://0.0.0.0:3000`

---

## 8. Create your admin user

```bash
npm run make-admin -- admin@sovereignml.com
```

The script prompts (hidden input, typed twice) for the password you want — or set `ADMIN_PASSWORD` in the env to skip the prompt. It creates the user with `role=admin` and a pre-verified email, or — if the account already exists (e.g. you registered via the sign-up page first) — promotes it to admin, keeping the existing password unless you type a new one.

Notes:
- Email defaults to `ADMIN_EMAIL` (or `admin@sovereignml.com`) when no argument is given.
- The db seed also creates this admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, but **in production it refuses to run with the weak dev default** — it skips the admin and tells you to run `make-admin` instead.
- In the Docker flow, prefix with `docker compose exec app`.

---

## 9. Turn `SEED_ON_BOOT` back off

After the first successful boot:

```bash
sed -i 's/^SEED_ON_BOOT=true/SEED_ON_BOOT=false/' .env.production
docker compose up -d
```

---

## 10. Smoke test — deploy an OpenClaw agent

1. Visit `https://sovereignml.example.com`, log in.
2. **Dashboard → Deploy Agent**.
3. Wizard: pick region (Singapore by default), pick a server size, enter a **domain you control** for this agent (e.g. `bot1.example.com`), review, deploy.
4. On the instance detail page you'll see:
   - Status cycles `provisioning` → `running` (1–3 minutes).
   - **DNS card** appears showing: "Add an A record: `bot1.example.com` → `<vps-ip>`".
   - Create that A record at your DNS provider.
   - Within ~60 s of propagation, card flips to **"Open agent → https://bot1.example.com"**.
5. **Credentials card**: click reveal → get admin email/password.
6. Click the agent URL → log in to OpenClaw → confirm chat works.

---

## Common problems

| Symptom                                                           | Fix                                                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL is not set` / Drizzle Kit errors                     | Ensure `DATABASE_URL` is set for the app container and that the startup script runs `npm run db:push` (or equivalent) before `next start`. |
| Schema out of date vs `src/db/schema.ts`                          | From the app container: `npm run db:push` (review diffs in staging first). Remove stale expectations around **Prisma** — see [TECH-STACK.md](TECH-STACK.md). |
| Agent stuck in `provisioning`                                     | `docker compose logs app \| grep provisionBot` — usually `LINODE_API_TOKEN` scope is wrong or `SSH_FLEET_*` keys malformed.   |
| Agent running but `dnsStatus=pending` forever                     | The user's A record for *their* agent domain isn't pointing at the agent VPS IP (shown on the instance page). Check DNS.     |
| Agent domain shows TLS warning                                    | Caddy on the agent VPS needs ~30 s after DNS resolves to fetch a cert. Wait and reload. If still broken: check port 80 open. |

---

## Day-2 ops

```bash
# Pull new code
cd /opt/sovereignml && git pull && docker compose up -d --build

# Tail app logs
docker compose logs -f app

# Postgres shell
docker compose exec postgres psql -U sovereignml -d sovereignml

# Manual local backup (one-off)
docker compose exec -T postgres pg_dump -U sovereignml sovereignml \
  | gzip > /var/backups/sovereignml-$(date +%F).sql.gz
```

> **Managed off-site backups → Cloudflare R2.** The admin panel has a built-in
> backup subsystem at **`/admin/backups`**: enter your R2 credentials once (stored
> encrypted in the DB), then take on-demand `pg_dump` snapshots, list/download them,
> restore from one, and run a nightly automated backup on a cron (see *Scheduled
> jobs* below). It shells out to `pg_dump`/`pg_restore`, so the **app host must have
> a `postgresql-client` whose major version is ≥ the Postgres server version**:
> `apt-get install -y postgresql-client`. If those binaries aren't on `PATH`, set
> `PG_DUMP_PATH` / `PG_RESTORE_PATH`. **Restore is destructive — it overwrites all
> live data** (`pg_restore --clean`); quiesce the app first and only restore onto a
> database you intend to replace.

---

## Feature configuration (optional)

The minimal `.env` in step 4 gets a single-Linode deploy working. The newer subsystems each have their own env vars — all listed in [`.env.example`](../.env.example) — and their own deep-dive docs.

### Multi-provider routing → [PROVIDERS.md](PROVIDERS.md)

```dotenv
VM_PROVIDER=linode            # default provider; the router scores + fails over across all configured ones
LINODE_API_TOKEN=...
DIGITALOCEAN_API_TOKEN=...    # optional second provider
# OVHcloud uses a multi-key credential set (not a single token):
OVH_APP_KEY=...
OVH_APP_SECRET=...
OVH_CONSUMER_KEY=...
OVH_CLOUD_PROJECT_ID=...
# OVH_ENDPOINT=ovh-eu         # ovh-eu | ovh-ca | ovh-us
```
Only providers with credentials are routed to. Budgets/priorities seed from `src/configs/providers.ts` and are then editable in the admin panel.

### Credit billing & margin → [BILLING.md](BILLING.md)

```dotenv
OPENROUTER_PROVISIONING_KEY=sk-or-prov-...   # mints per-instance keys (already in step 4)
OPENROUTER_MARGIN=0.9                         # gross-margin fraction; 0.9 = 10% margin
ANOMALY_USD_PER_INTERVAL=50                   # per-poll spend spike that triggers enforcement
```

### Integrations → [INTEGRATIONS.md](INTEGRATIONS.md)

```dotenv
# Google Drive backups (reuses the Google OAuth app; needs its own redirect URI)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_REDIRECT_URI=https://sovereignml.example.com/api/integrations/drive/callback

# Platform Cloudflare (managed subdomains). Users connect their OWN token in-app — never here.
CLOUDFLARE_API_TOKEN=...     # Zone:DNS:Edit + Zone:SSL:Edit on the base domain's zone
CLOUDFLARE_ZONE_ID=...
CLOUDFLARE_BASE_DOMAIN=...
```

### Runtimes → [RUNTIMES.md](RUNTIMES.md)

```dotenv
# OPENCLAW_VERSION=          # version pins (default to code-baked versions)
# HERMES_VERSION=
# OPEN_WEBUI_VERSION=
# HERMES_MODEL=              # override the default ≥64k Hermes model
NVIDIA_API_KEY=...           # optional DeepSeek fallback provider (mid tier)
```

## Scheduled jobs

Several subsystems are driven by cron hitting authenticated endpoints with a `Authorization: Bearer <token>` header (generate tokens with `openssl rand -hex 32`):

| Endpoint | Token env | Suggested cadence | Purpose |
|----------|-----------|-------------------|---------|
| `POST /api/billing/usage-sync` | `USAGE_SYNC_CRON_TOKEN` | ~every 10 min | Poll OpenRouter spend, charge wallets, enforce caps ([BILLING.md](BILLING.md)). |
| `POST /api/billing/daily` | `BILLING_CRON_TOKEN` | daily | Daily compute billing (accrues provider usage). |
| `POST /api/billing/expire-credits` | `CREDIT_EXPIRY_CRON_TOKEN` | daily | Expire use-it-or-lose-it plan credits past their period end (cancelled/lapsed subs); re-syncs OpenRouter caps down ([BILLING.md](BILLING.md)). |
| `POST /api/audit-log/prune` | `AUDIT_RETENTION_CRON_TOKEN` | daily | Delete audit-log rows older than 7 days. |
| `POST /api/admin/notifications/prune` | `ADMIN_NOTIFICATION_RETENTION_CRON_TOKEN` | daily | Delete **resolved** admin notifications older than 30 days. |
| `POST /api/internal/alerts-eval` | `ALERTS_EVAL_CRON_TOKEN` | ~every 5–10 min | Evaluate team alert rules against recent agent events and fire notifications. Without this cron, alert rules never trigger. |
| `POST /api/internal/events-prune` | `EVENTS_RETENTION_CRON_TOKEN` | daily | Delete `AgentEvent` rows older than `EVENTS_RETENTION_DAYS` (default 30). Without this cron, the events table grows unbounded. |
| `POST /api/admin/reconcile` | `RECONCILE_CRON_TOKEN` | daily | Orphan/state reconciliation; **also** runs provider health probes + budget/burn-rate sync so the router scores on fresh data ([PROVIDERS.md](PROVIDERS.md)). Allow ≥60s timeout. |
| `POST /api/admin/backups/cron` | `BACKUP_CRON_TOKEN` | nightly | Full `pg_dump` of the database, streamed to Cloudflare R2, with retention pruning. Requires R2 creds configured in `/admin/backups` and a `postgresql-client` on the app host. Allow ≥120s timeout. |

Each can also be triggered manually by an admin session from the admin panel. Wire them with any scheduler (system cron, a GitHub Actions schedule, or an external uptime/cron service).

## Stripe go-live checklist

Billing is fully implemented but disabled in dev (auto-grant). To take real payments in production, complete all of these — the server refuses to boot (`assertBillingConfig`) until the required pieces are in place:

1. **Create products + prices** in the Stripe dashboard for each paid plan tier.
2. **Set the `STRIPE_PRICE_*` IDs** in your env (12 of them, names match `src/configs/plans.ts`). *Currently informational only* — Checkout builds inline `price_data`, so these aren't required for payments to work yet, but set them for clean Stripe reporting/tax and future migration.
3. **Register the webhook endpoint** `https://<your-domain>/api/webhooks/stripe` in the Stripe dashboard for the events the handler consumes: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `customer.subscription.updated/deleted`, `charge.refunded`, `charge.dispute.created/closed`. Paste the signing secret into `STRIPE_WEBHOOK_SECRET` (`whsec_…`).
4. **Switch `STRIPE_SECRET_KEY` to a live key** (`sk_live_…`).
5. **Enable + configure the Stripe Customer Portal** (Settings → Billing → Customer portal) — required by `/api/billing/portal`.
6. **Set `NEXT_PUBLIC_APP_URL`** to your public `https://` domain (Checkout success/cancel redirects), and set the cron tokens `BILLING_CRON_TOKEN`, `RECONCILE_CRON_TOKEN`, `USAGE_SYNC_CRON_TOKEN`, `BACKUP_CRON_TOKEN`.

## What this does NOT cover

- Multi-node / HA — this is a single-VPS deploy.
- Stripe webhook setup — see the [Stripe go-live checklist](#stripe-go-live-checklist) above; the webhook endpoint is `https://<your-domain>/api/webhooks/stripe`.
- Email (Resend) — paste `RESEND_API_KEY` + `RESEND_FROM_EMAIL` if you want password-reset / magic-link flows.
- Log shipping / metrics — run Grafana/Loki separately if you need it.
