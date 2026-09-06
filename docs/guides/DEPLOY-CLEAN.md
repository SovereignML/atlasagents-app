# Clean-database deployment (for dummies)

> Stand up a brand-new Atlas Agents control plane from a bare VPS and an empty Postgres to a working, HTTPS, agents-deploying platform — in order, copy-paste, nothing assumed. This is the **canonical clean-install walkthrough**; it supersedes the Docker flow that used to live in [DEPLOYMENT.md](../DEPLOYMENT.md).

Related: [ENVIRONMENT.md](ENVIRONMENT.md) (what every variable means), [deploy/README.md](../../deploy/README.md) (terse runbook), [DEPLOYMENT.md](../DEPLOYMENT.md) (scheduled-jobs + Stripe reference).

> **⚠️ Bare-metal is the supported path. There is no Docker in this repo** — no `Dockerfile`, no `docker-compose.yml`. Node + Postgres install directly on the VPS; the Next.js standalone server runs under **pm2** or **systemd**, behind **Caddy** and/or **Cloudflare**. Ignore any `docker compose` instructions in older docs.

---

## 0. What you need before you start

- A **VPS** — Ubuntu 22.04+ recommended, **2 vCPU / 4 GB RAM** minimum.
- A **domain** you control with DNS access (e.g. `app.example.com`).
- A **DigitalOcean API token** (primary provider) — [create one](https://cloud.digitalocean.com/account/api/tokens) with **write** scope. This is what the platform uses to spin up user agent VMs. *(Optional: a Linode token for failover — scopes `linodes:read_write` + `stackscripts:read_write`.)*
- An **OpenRouter provisioning key** — [create one](https://openrouter.ai/settings/provisioning-keys). Mints a per-agent LLM key at deploy time.
- **Stripe** keys — *optional in dev, **required in production*** (the server refuses to boot without them). See [step 13](#13-stripe-go-live).
- *(Optional)* Google OAuth credentials for Google sign-in + Drive backups.

Full meaning of every variable below: **[ENVIRONMENT.md](ENVIRONMENT.md)**.

---

## 1. Provision the server

SSH in as root (or a sudo user) and open the firewall:

```bash
ssh root@YOUR_VPS_IP

ufw allow 22,80,443/tcp
ufw --force enable
```

## 2. Install dependencies

```bash
# Node 22 (NodeSource — aligns with the OpenClaw VPS bootstrap)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-client caddy git

# pm2 for process management
sudo npm i -g pm2
```

> `postgresql-client` is needed for the admin R2 backup subsystem (its major version must be ≥ the Postgres server version). `caddy` is the easy reverse proxy with automatic TLS. Skip `caddy` if you'll use nginx or a Cloudflare Tunnel.

## 3. Clone + install

```bash
sudo mkdir -p /opt/redesigned-giggle /var/log/redesigned-giggle
sudo chown -R $USER /opt/redesigned-giggle /var/log/redesigned-giggle

git clone <your-repo-url> /opt/redesigned-giggle
cd /opt/redesigned-giggle
npm ci --no-audit --no-fund
```

## 4. Generate your secrets

Run these and keep the output — you'll paste them into `.env` shortly:

```bash
# NextAuth session secret (use for BOTH NEXTAUTH_SECRET and AUTH_SECRET)
openssl rand -base64 32

# Instance encryption key (encrypts root/admin passwords + tokens at rest)
openssl rand -base64 32

# SSH fleet key — the platform SSHes into every VM it provisions with this
ssh-keygen -t ed25519 -f /tmp/sovereign_fleet -N ""
echo "---PRIVATE (base64, one line → SSH_FLEET_PRIVATE_KEY)---"
base64 -w0 /tmp/sovereign_fleet; echo
echo "---PUBLIC (→ SSH_FLEET_PUBLIC_KEY)---"
cat /tmp/sovereign_fleet.pub
rm /tmp/sovereign_fleet /tmp/sovereign_fleet.pub    # keys live in env only

# One token per cron job (generate 13; see step 12)
openssl rand -hex 32
```

## 5. Bootstrap the clean database — one command

This is the step that turns an **empty Postgres into a ready schema** and writes your `.env`:

```bash
bash scripts/bootstrap-pg.sh
```

The script is **idempotent** and does everything by hand-free:

- Verifies Postgres is reachable as the `postgres` superuser.
- **Checks `pg_hba.conf`** — if `127.0.0.1/32` uses `peer`/`ident`/`trust`, it offers to patch it to `scram-sha-256` and reload Postgres. **Answer `y`** — password auth silently fails otherwise. *(This is the #1 gotcha.)*
- Creates/aligns the `sovereignml` role + database.
- Writes `.env` (mode `600`) with a matching `DATABASE_URL` and an `AUTH_SECRET` if none is set. Re-runs preserve the existing password.
- Smoke-tests the connection.
- **Syncs the schema** with `drizzle-kit push --force`.

> **Schema is managed by `push`, never `migrate`.** There is no populated migrations journal — `npm run db:migrate` would fail on existing columns. All schema changes flow through `drizzle-kit push` (this script, and the deploy entrypoint on every restart). Never run `db:generate`/`db:migrate` against a real DB.

## 6. Fill in the rest of `.env`

`bootstrap-pg.sh` wrote `DATABASE_URL` + `AUTH_SECRET`. Now open `.env` and add the rest. The minimum-viable production set:

```dotenv
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXTAUTH_URL=https://app.example.com
NEXTAUTH_SECRET=<from step 4>       # keep equal to AUTH_SECRET
AUTH_SECRET=<same value>
AUTH_TRUST_HOST=true
INSTANCE_ENCRYPTION_KEY=<from step 4>

# LLM + provisioning
OPENROUTER_PROVISIONING_KEY=sk-or-prov-...
VM_PROVIDER=digitalocean
DIGITALOCEAN_API_TOKEN=...
SSH_FLEET_PRIVATE_KEY=<base64 from step 4>
SSH_FLEET_PUBLIC_KEY=ssh-ed25519 ...

# Billing — REQUIRED in production
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Cron auth tokens (one each — see step 12)
BILLING_CRON_TOKEN=...
RECONCILE_CRON_TOKEN=...
USAGE_SYNC_CRON_TOKEN=...
BACKUP_CRON_TOKEN=...
```

Every variable — including the optional feature blocks (Cloudflare, Google, Chatwoot, Sentry, PostHog, Uptime Kuma, warm pool) — is explained in **[ENVIRONMENT.md](ENVIRONMENT.md)**.

## 7. Seed the database

Seeds regions, server configs, plans, the BYOS sentinel rows, and providers:

```bash
npm run db:seed
# or fold it into the bootstrap:  DB_SEED=1 bash scripts/bootstrap-pg.sh
```

> In **production** the seed **skips creating the admin** unless `ADMIN_PASSWORD` is set (no weak default). That's expected — create the admin explicitly next.

## 8. Create your first admin

```bash
npm run make-admin -- admin@example.com
```

Prompts (hidden, twice) for the password — or set `ADMIN_PASSWORD` in `.env` to skip the prompt. It creates a `role=admin` user with a pre-verified email, or promotes an existing account. It **refuses the weak dev default** `admin123456`.

## 9. Build

```bash
npm run build
```

> The `postbuild` script copies `public/` and `.next/static/` into `.next/standalone/` — **mandatory** for the standalone server to serve assets. `npm run build` runs it automatically; don't invoke `next build` directly and skip it.

## 10. Start the server — pick one

Both paths run [`scripts/deploy-entrypoint.sh`](../../scripts/deploy-entrypoint.sh), which **re-syncs the schema** (`drizzle-kit push --force`, non-fatal) **before** accepting traffic, then execs the standalone server on `127.0.0.1:3000`. So future deploys that add columns need only rebuild + restart — no manual `db:push`.

### Option A — pm2

```bash
pm2 start deploy/pm2.config.cjs
pm2 save
pm2 startup          # run the printed command once, for boot persistence
pm2 logs redesigned-giggle
```

### Option B — systemd

```bash
# Create the service user once
sudo useradd --system --home /opt/redesigned-giggle --shell /usr/sbin/nologin nextjs
sudo chown -R nextjs:nextjs /opt/redesigned-giggle /var/log/redesigned-giggle

# systemd reads env from a separate file (NOT the repo .env)
sudo cp .env /etc/redesigned-giggle.env
sudo chown nextjs:nextjs /etc/redesigned-giggle.env
sudo chmod 600 /etc/redesigned-giggle.env

sudo cp deploy/redesigned-giggle.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now redesigned-giggle
journalctl -u redesigned-giggle -f
```

> **pm2/bootstrap will refuse to start** if a stray `.env.local` / `.env.production` exists on disk. Delete them — only `.env` is allowed.

## 11. Reverse proxy + HTTPS

Point DNS at the VPS, then front the app with TLS.

**DNS:** create an `A` record for your dashboard host → your VPS IP. Verify with `dig +short app.example.com`.

**Caddy (easiest — automatic Let's Encrypt):**

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# Edit /etc/caddy/Caddyfile: set a real ACME email and replace app.example.com.
# It proxies to 127.0.0.1:3000 and 403s the loopback-only /api/internal/* namespace.
sudo systemctl reload caddy
```

Alternatives: **nginx + certbot** proxying `127.0.0.1:3000`, or a **Cloudflare Tunnel** pointed at `http://127.0.0.1:3000`.

**Cloudflare for managed agent DNS + white-label** (optional): set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_BASE_DOMAIN` so provisioning can upsert proxied `A` records per agent. For per-team custom dashboard domains, configure **Cloudflare for SaaS** (`CLOUDFLARE_SAAS_ZONE_ID`, `WHITELABEL_CNAME_TARGET`, `WHITELABEL_FALLBACK_ORIGIN`) — see [deploy/README.md §8–§10](../../deploy/README.md).

## 12. Wire the cron jobs

Frequent internal jobs run from one crontab line via [`scripts/cron-tick.sh`](../../scripts/cron-tick.sh) (it curls localhost, skipping any endpoint whose token env is unset):

```bash
crontab -e
# every minute — uptime-sync, metrics-collect, alerts-eval, usage-sync, demo-reap:
* * * * * /opt/redesigned-giggle/scripts/cron-tick.sh >> /var/log/redesigned-giggle/cron.log 2>&1
```

The **daily/nightly** jobs are **not** in that script — add them as separate crontab lines with their bearer tokens:

```bash
# daily billing, credit lifecycle, prunes, reconcile:
0 2 * * *  curl -fsS -X POST -H "Authorization: Bearer $BILLING_CRON_TOKEN"          http://127.0.0.1:3000/api/billing/daily
5 2 * * *  curl -fsS -X POST -H "Authorization: Bearer $CREDIT_EXPIRY_CRON_TOKEN"    http://127.0.0.1:3000/api/billing/expire-credits
10 2 * * * curl -fsS -X POST -H "Authorization: Bearer $AUDIT_RETENTION_CRON_TOKEN"  http://127.0.0.1:3000/api/audit-log/prune
15 2 * * * curl -fsS -X POST -H "Authorization: Bearer $ADMIN_NOTIFICATION_RETENTION_CRON_TOKEN" http://127.0.0.1:3000/api/admin/notifications/prune
20 2 * * * curl -fsS -X POST -H "Authorization: Bearer $EVENTS_RETENTION_CRON_TOKEN" http://127.0.0.1:3000/api/internal/events-prune
30 2 * * * curl -fsS --max-time 120 -X POST -H "Authorization: Bearer $RECONCILE_CRON_TOKEN" http://127.0.0.1:3000/api/admin/reconcile
0 3 * * *  curl -fsS --max-time 180 -X POST -H "Authorization: Bearer $BACKUP_CRON_TOKEN"    http://127.0.0.1:3000/api/admin/backups/cron
```

> **`expire-credits` matters:** without the daily run, **yearly subscribers only ever receive their first month of credits**. The full annotated table (cadence, purpose, timeouts) is in [DEPLOYMENT.md → Scheduled jobs](../DEPLOYMENT.md#scheduled-jobs). The **warm VM pool self-refills in-process** (no external cron); `pool-refill` is only an optional backstop. Stripe events arrive at the webhook `/api/webhooks/stripe`, not via cron.

## 13. Stripe go-live

Billing is auto-granted in dev but **required in production** — the boot gate (`assertBillingConfig`) blocks startup until it's configured. Complete the checklist in [DEPLOYMENT.md → Stripe go-live checklist](../DEPLOYMENT.md#stripe-go-live-checklist): create products/prices, register the webhook `https://<your-domain>/api/webhooks/stripe`, paste `whsec_…` into `STRIPE_WEBHOOK_SECRET`, switch to a live `sk_live_…` key, enable the Customer Portal, and set the cron tokens.

## 14. Smoke test

1. Visit `https://app.example.com` and log in as your admin.
2. **Dashboard → Deploy Agent** → run the 4-step wizard (Agent → Project → Plan → Billing) and deploy an OpenClaw agent.
3. Watch the instance page cycle `provisioning → running` (managed deploys claim a warm-pool VM for sub-25s delivery; cold provisioning is the fallback).
4. Reveal the credentials card, open the agent URL, confirm chat works.

## 15. Upgrades (day 2)

```bash
cd /opt/redesigned-giggle
git pull
npm ci --no-audit --no-fund
bash scripts/bootstrap-pg.sh        # idempotent: re-syncs schema, preserves .env
npm run build
pm2 restart redesigned-giggle       # or: sudo systemctl restart redesigned-giggle
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `[pm2 guard] Refusing to start: … these files exist` | A stray `.env.local` / `.env.production`. Copy what you need into `.env` and delete the others. |
| `Authentication failed against the database server` | `DATABASE_URL` password ≠ the Postgres role's. Re-run `bash scripts/bootstrap-pg.sh` — it re-aligns them. |
| Password auth silently fails | `pg_hba.conf` `127.0.0.1/32` is on `peer`/`ident`/`trust`. Let bootstrap patch it to `scram-sha-256`, or edit `/etc/postgresql/*/main/pg_hba.conf` and `sudo systemctl reload postgresql`. |
| Server won't boot in production | The billing gate — set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, an `https` `NEXT_PUBLIC_APP_URL`, and the cron tokens. |
| Seed didn't create the admin | Expected in production without `ADMIN_PASSWORD` — run `npm run make-admin -- <email>`. |
| Agent stuck in `provisioning` | Usually a bad provider token scope or malformed `SSH_FLEET_*` keys. Check `pm2 logs` / `journalctl`. Set `KEEP_FAILED_VMS=true` to keep the VM for inspection. |
| Static assets 404 | The `postbuild` copy didn't run. Use `npm run build`, not a bare `next build`. |

## What this does not cover

- Multi-node / HA (this is a single-VPS control plane).
- Log shipping / external metrics (run Grafana/Loki separately if needed).
- Per-feature setup depth — see the deep-dive docs linked from [docs/README.md](../README.md).
