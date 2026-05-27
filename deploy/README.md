# Bare-metal VPS deploy

Node + Postgres installed directly on a VPS, with the Next.js standalone
server managed by **pm2** or **systemd**.

## Env policy — read this once

The app loads **exactly one env file: `.env` at the repo root**. Next.js'
multi-file layering (`.env.local`, `.env.production`, ...) has bitten
this project in production and is now explicitly banned:

- `.gitignore` ignores all of them.
- `deploy/pm2.config.cjs` refuses to start if any of them exist on disk.
- The bootstrap script refuses to run if any of them exist.

If you need a different value per environment, change `.env` on that
box. Don't create a second env file.

## 1. Prerequisites on the VPS

```bash
# Node 22 (NodeSource; aligns with OpenClaw VPS bootstrap)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql

# pm2 for process management
sudo npm i -g pm2
```

## 2. Clone + install

```bash
sudo mkdir -p /opt/redesigned-giggle /var/log/redesigned-giggle
sudo chown -R $USER /opt/redesigned-giggle /var/log/redesigned-giggle

git clone <repo> /opt/redesigned-giggle
cd /opt/redesigned-giggle
npm ci --no-audit --no-fund
```

## 3. Bootstrap Postgres + .env + schema — one command

```bash
bash scripts/bootstrap-pg.sh
```

That script is idempotent and does everything the old runbook did by hand:

- Verifies Postgres is reachable as the `postgres` superuser.
- Sanity-checks `pg_hba.conf` — if `127.0.0.1/32` is using
  `peer`/`ident`/`trust`, prompts to patch it to `scram-sha-256` and
  reload Postgres (password auth silently fails otherwise).
- Creates/aligns the `sovereignml` role + database.
- Writes `.env` (mode 600) with a matching `DATABASE_URL` and an
  `AUTH_SECRET` if one isn't already set. Re-runs preserve the existing
  password.
- Smoke-tests the connection with `psql`.
- Syncs the schema with `drizzle-kit push`.
- `DB_SEED=1 bash scripts/bootstrap-pg.sh` also runs the seed.

Add any other secrets you need (`NEXTAUTH_URL`, `STRIPE_*`, `RESEND_*`,
...) to `.env` after the script finishes.

## 4. Build

```bash
npm run build       # admin/dashboard are force-dynamic, safe with no DB
```

## 5. Start — pick one

### pm2

```bash
pm2 start deploy/pm2.config.cjs
pm2 save
pm2 startup          # follow the printed command once, for boot persistence
pm2 logs redesigned-giggle
```

### systemd

```bash
# Create the service user once:
sudo useradd --system --home /opt/redesigned-giggle --shell /usr/sbin/nologin nextjs
sudo chown -R nextjs:nextjs /opt/redesigned-giggle /var/log/redesigned-giggle

sudo cp deploy/redesigned-giggle.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now redesigned-giggle
journalctl -u redesigned-giggle -f
```

## 6. Upgrades

```bash
cd /opt/redesigned-giggle
git pull
npm ci --no-audit --no-fund
bash scripts/bootstrap-pg.sh        # idempotent: syncs schema, preserves .env
npm run build
pm2 restart redesigned-giggle       # or: sudo systemctl restart redesigned-giggle
```

## 7. Reverse proxy

Point nginx / Cloudflare Tunnel at `127.0.0.1:3000`. Standard Next.js
reverse-proxy setup — no special headers required beyond `X-Forwarded-*`.

For **per-team white-label custom dashboard domains**, the public listener must be **Caddy** (on-demand TLS) instead of nginx/Tunnel — see §10.

## 8. Cloudflare (managed agent hostnames / VPS edge)

Provisioning can upsert **proxied DNS** for each instance via the Cloudflare API:

- **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ZONE_ID`** — required for automatic `A` records on your zone (e.g. `*.example.com` or per-agent names). That gives you **DNS + TLS at the Cloudflare edge** (visitors hit HTTPS on Cloudflare first).

**Origin connection** (Cloudflare → your Linode VM) is separate:

- **Without** **`CLOUDFLARE_ORIGIN_CERT_PEM`** / **`CLOUDFLARE_ORIGIN_CERT_KEY`**: the VM may serve HTTP on port 80 only behind Caddy; use Cloudflare SSL mode **Flexible** (HTTPS to clients, HTTP to origin), or terminate TLS another way you control.
- **With** origin cert + key in env: the bootstrap can install them on the VM and Caddy can serve **HTTPS on the managed hostname** toward the origin; you can use **Full (strict)** in Cloudflare.

Pin **`OPENCLAW_VERSION`** in `.env` to a semver you have tested so VPS bootstrap does not pull breaking CLI changes from `latest`.

## 9. Google Drive backups (per-agent)

Users can back up an agent's settings to their **own** Google Drive and restore them later. This reuses the existing **`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`** (the feature is hidden when Google OAuth isn't configured), via a dedicated consent flow separate from login.

In the Google Cloud console for that OAuth client:

- Add the Drive **Authorized redirect URI**: `<NEXT_PUBLIC_APP_URL>/api/integrations/drive/callback` (override with **`GOOGLE_DRIVE_REDIRECT_URI`** if needed). This is in addition to the NextAuth login callback `/api/auth/callback/google`.
- On the **OAuth consent screen**, add the scope `https://www.googleapis.com/auth/drive.file` (app-created files only — minimal access).

Backups contain agent **settings only** (config, persona, skills, model tier, interface) — never secrets, IPs, or tokens. The encrypted Drive refresh token is stored with **`INSTANCE_ENCRYPTION_KEY`** (same key used for other instance secrets). v1 "restore as a new agent" provisions on the free tier; use "restore in place" for existing paid agents.

## 10. Custom dashboard domains (per-team white-label)

Teams on **Scale/Enterprise** can serve the dashboard on their own domain (e.g. `app.agency.com`). This needs Caddy as the public **`:443`** listener in front of the Next app, because TLS for arbitrary customer domains is issued **on demand**.

> A Cloudflare Tunnel **cannot** terminate TLS for third-party customer domains (it can't fetch Let's Encrypt certs for domains it doesn't control). So for white-label domains, Caddy — not a tunnel — must be the public listener. The app must bind to **`127.0.0.1:3000`** (loopback).

**Setup:**

1. Install Caddy on the app host and use **`deploy/Caddyfile`**:
   - set the ACME **`email`** and replace **`app.example.com`** with your canonical dashboard host;
   - the catch-all `https://` block issues per-domain certs on demand.
2. The on-demand `ask` points at **`/api/internal/tls-authorize`** — Caddy calls it over loopback before issuing each cert; it returns `200` only when the SNI is a **verified** custom domain on a **currently-entitled** team. The Caddyfile also `respond 403`s `/api/internal/*` from the public site blocks so the endpoint isn't externally probeable. Optionally set **`TLS_AUTHORIZE_SECRET`** (an extra shared-secret header) if you front the ask with your own proxy.
3. Tell customers to point their domain at you with a **CNAME** to the value shown in the branding settings UI (defaults to your canonical host; override with **`WHITELABEL_CNAME_TARGET`**).

**Per-team flow** (in `/dashboard/settings/branding`): connect domain → publish the **`_sovereignml-verify.<domain>`** TXT record → **Verify** (proves ownership) → add the **CNAME** → first HTTPS hit triggers on-demand cert issuance. DNS/TLS status badges poll automatically.

**OAuth on custom domains:** provider redirect URIs can't be pre-registered for arbitrary domains, so the login page on a custom host shows **email/password only** — OAuth (Google/Twitter/Apple) stays on the canonical domain. Register OAuth redirect URIs only for the canonical host.

**Downgrade:** entitlement is re-checked live on every branding read and every cert `ask`, so a team that drops below Scale/Enterprise reverts to the default look and stops getting fresh certs — its stored config is kept (re-upgrading restores it).

**Alternative:** Cloudflare for SaaS (custom hostnames) can offload TLS to Cloudflare's edge instead of Caddy on-demand; reuse `src/lib/cloudflare.ts`'s fetch wrapper against the `/custom_hostnames` API. The Caddy path is the default here (no extra Cloudflare product, self-hosted-friendly).

## When instance (VPS) provisioning fails

Provisioning runs over SSH in ordered **stages** (see `src/lib/provisioner.ts`): VM create → boot → bootstrap (Node, Caddy, OpenClaw) → **writing_config** (Phase A) → **installing_service** (Phase B: Caddyfile, `caddy validate`, Caddy active, systemd unit, `daemon-reload`, `enable`) → **starting_service** → **health_check** → commit.

### Preserving a failed VM for debugging

Set **`KEEP_FAILED_VMS=true`** in the app environment. On failure, the provisioner will **not** delete the Linode VM so you can SSH in and inspect logs. Remove the variable or set it to `false` for normal operation (failed VMs are deleted to avoid cost).

### Reading instance logs and exit codes

- **Stdout markers** in Phase B look like `=== provision: caddy_validate ===`, `=== provision: systemd_daemon_reload ===`, and so on. The **last marker printed** before a failure localizes the step (e.g. still at `caddy_wait_active` vs `systemd_daemon_reload`).
- **Exit 124** on the **remote** script usually means **GNU `timeout`** killed a subprocess. Phase B no longer wraps `systemctl daemon-reload` / `enable` in a short `timeout`; a remaining 124 is more likely from **`caddy validate`** (still wrapped with a bounded `timeout` so bad configs fail fast) or a different environment quirk. **Exit 1** with `caddy did not reach active` points at Caddy, not the systemd `timeout` class.
- After failure, the app may log **diagnostic** lines. Lines ending **`(ok)`** are successful snapshots; only **`SSH unreachable`** means the check did not run.

### Confirming slow `systemd` on the host

If you kept the VM, SSH in as root and measure:

```bash
time systemctl daemon-reload
time systemctl status caddy --no-pager
journalctl -u caddy --no-pager -n 100
```

If `daemon-reload` is consistently fast (under a few seconds) but provision still failed earlier, triage Caddy and journal output instead of only systemd slowness.

### Re-testing after a fix

Re-run a full provision (smallest or slowest plan is a good stress test) and confirm the instance reaches `running`. If Phase B still fails, use the last **echo** line in the provision log, preserved VM + commands above, and Caddy journal diagnostics from the failed run.

## Troubleshooting

- **`[pm2 guard] Refusing to start: ... these files exist`** — you have
  a stray `.env.production` or `.env.local`. Copy anything you need into
  `.env` and delete the others.
- **`Authentication failed against the database server`** — the
  `DATABASE_URL` password doesn't match the Postgres role's password.
  Re-run `bash scripts/bootstrap-pg.sh` — it re-aligns them.
- **pg_hba peer/ident/trust** — the bootstrap script offers to patch
  this. If you declined, edit `/etc/postgresql/*/main/pg_hba.conf`,
  change the `127.0.0.1/32` line to `scram-sha-256`, and
  `sudo systemctl reload postgresql`.
