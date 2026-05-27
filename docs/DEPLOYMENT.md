# SovereignML deployment guide (for dummies)

End-to-end: from fresh VPS → public HTTPS URL → one-click OpenClaw deploys working.

---

## 0. What you need before you start

- A VPS (Ubuntu 22.04+ recommended, 2 vCPU / 4 GB RAM minimum).
- A domain you control (e.g. `sovereignml.example.com`) with DNS access.
- A **Linode** API token — [create one here](https://cloud.linode.com/profile/tokens) with scopes `linodes:read_write` + `stackscripts:read_write`. This is what the platform uses to spin up user VMs.
- An **OpenRouter** API key — [get one here](https://openrouter.ai/keys). Powers OpenClaw's LLM calls.
- *(Optional)* Stripe keys if you want real billing. Leave blank for dev mode (auto-activates instances, skips payment).
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
docker compose exec app npx tsx scripts/make-admin.ts you@example.com
```

Then register via the app's sign-up page — the user with that email will be promoted to `admin`.

*(If no `make-admin.ts` script exists yet, run it manually:)*
```bash
docker compose exec postgres psql -U sovereignml -d sovereignml \
  -c "UPDATE \"User\" SET role='admin' WHERE email='you@example.com';"
```

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

# Backups (run on a cron)
docker compose exec -T postgres pg_dump -U sovereignml sovereignml \
  | gzip > /var/backups/sovereignml-$(date +%F).sql.gz
```

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
| `POST /api/admin/reconcile` | `RECONCILE_CRON_TOKEN` | daily | Orphan/state reconciliation; **also** runs provider health probes + budget/burn-rate sync so the router scores on fresh data ([PROVIDERS.md](PROVIDERS.md)). Allow ≥60s timeout. |

Each can also be triggered manually by an admin session from the admin panel. Wire them with any scheduler (system cron, a GitHub Actions schedule, or an external uptime/cron service).

## What this does NOT cover

- Multi-node / HA — this is a single-VPS deploy.
- Stripe webhook setup — if you enable billing, configure webhook endpoint `https://sovereignml.example.com/api/stripe/webhook` in Stripe dashboard and paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
- Email (Resend) — paste `RESEND_API_KEY` + `RESEND_FROM_EMAIL` if you want password-reset / magic-link flows.
- Log shipping / metrics — run Grafana/Loki separately if you need it.
