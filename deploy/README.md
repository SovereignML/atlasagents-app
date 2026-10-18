# Bare-metal VPS deploy

Node + Postgres installed directly on a VPS, with the Next.js standalone
server managed by **pm2** or **systemd**.

> For a step-by-step **clean-database → live** narrative (secrets, seeding,
> admin, TLS, cron, Stripe), see [`docs/guides/DEPLOY-CLEAN.md`](../docs/guides/DEPLOY-CLEAN.md).
> This file is the terse runbook reference for the same bare-metal path.

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
# Node 22 (NodeSource) for the control plane itself. This is NOT the Node the
# agent VPS bootstrap installs — that is derived from each runtime's own floor
# and is currently 24 (see docs/RUNTIMES.md).
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
...) to `.env` after the script finishes. For real payments, follow the
Stripe go-live checklist in `docs/DEPLOYMENT.md` — in production the app
won't boot without valid Stripe keys, webhook secret, and cron tokens.

## 4. Build

```bash
npm run build       # admin/dashboard are force-dynamic, safe with no DB
```

## 5. Start — pick one

Both start paths run `scripts/deploy-entrypoint.sh`, which syncs the DB schema
(`drizzle-kit push --force`, idempotent — the same tool `bootstrap-pg.sh` uses)
**before** the server accepts traffic, then execs the standalone server. So a
deploy that adds columns no longer needs a manual `db:push` step — just rebuild
and restart. The sync is non-fatal: if it fails, the entrypoint logs a warning
and starts the server anyway with the existing schema, so a schema-tool problem
degrades to a couple of erroring pages rather than a full crash-loop.

`push --force` drops any table or column the schema doesn't define, without
asking. So the entrypoint first runs `scripts/schema-guard.ts`, which lists
what the push would drop and **skips the push** if anything would be, starting
the server on the existing schema instead (look for `schema sync SKIPPED` in
the log). New columns are then not applied, so resolve it before relying on
the deploy: add the table or column to `src/db/schema.ts` to keep it, or back
it up and list it in `SCHEMA_GUARD_ALLOW_DROP` (comma-separated `Table` or
`Table.column`) to let the push drop it. Run the guard by hand with
`node --env-file=.env --import tsx scripts/schema-guard.ts`.

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

`pm2 restart` keeps the environment pm2 already holds. When an upgrade changes
the `env` block in `deploy/pm2.config.cjs` (as the loopback bind below did),
reload from the file instead, then save:

```bash
pm2 reload deploy/pm2.config.cjs --update-env && pm2 save
ss -ltn | grep ':3000 '             # expect 127.0.0.1:3000, not 0.0.0.0:3000
```

## 7. Reverse proxy

Point nginx / Cloudflare Tunnel at `127.0.0.1:3000`. Standard Next.js
reverse-proxy setup — no special headers required beyond `X-Forwarded-*`.

The server binds to loopback (`HOSTNAME=127.0.0.1` in both start paths), so the
proxy must run on the same host. **If the proxy runs on another machine** (as
production does, with Nginx Proxy Manager), set `HOSTNAME=0.0.0.0` in `.env`,
reload with `pm2 reload deploy/pm2.config.cjs --update-env && pm2 save`, and add
a cloud-firewall rule that lets only the proxy's IP reach port 3000. Also deny
`/api/internal/*` in the proxy (Caddy does it with `respond @internal 403`); the
routes check a cron token or admin session themselves, but they are not meant to
be reachable from outside. Anything that called the app at
`http://<server-ip>:3000` must use the public https URL instead — in particular
`NEXT_PUBLIC_GATEWAY_BASE_URL`, which agents post their events and usage to.

From the internet, only 22, 80 and 443 should answer. Enforce that in the cloud
firewall (Azure network security group, DigitalOcean cloud firewall), not only
with `ufw`: Docker-published ports such as Uptime Kuma's `-p 3001:3001` bypass
`ufw` entirely. Publish those on loopback (`-p 127.0.0.1:3001:3001`) and reach
them through the proxy or an SSH tunnel.

**Per-team white-label custom dashboard domains** are served via **Cloudflare for SaaS** (the edge terminates TLS and proxies to your origin), so they no longer require Caddy as the public listener — see §10.

## 8. Cloudflare (managed agent hostnames / VPS edge)

Provisioning can upsert **proxied DNS** for each instance via the Cloudflare API:

- **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ZONE_ID`** — required for automatic `A` records in the agent zone (`sovereignclaw.xyz` by default: `<name>.sovereignclaw.xyz`). That gives you **DNS + TLS at the Cloudflare edge** (visitors hit HTTPS on Cloudflare first).
- **`CLOUDFLARE_AGENT_DOMAIN`** / **`CLOUDFLARE_AGENT_ZONE_ID`** (+ `_ORIGIN_CERT_*`) — optional: move **new** agents to another zone (`atlasdeploy.xyz`); existing agents keep their hostnames. Check the config with `node --env-file=.env --import tsx scripts/check-agent-zones.ts --live`. Runbook: [`docs/REBRAND-LEGACY-IDENTIFIERS.md`](../docs/REBRAND-LEGACY-IDENTIFIERS.md#the-managed-agent-zone-sovereignclawxyz).

**Origin connection** (Cloudflare → the agent box) is separate:

- **With** the zone's origin cert + key in env (`CLOUDFLARE_ORIGIN_CERT_*`, or `CLOUDFLARE_AGENT_ORIGIN_CERT_*` for the new zone): the provisioner installs it over SSH on every box when the agent is configured — cold VPS, warm pool and BYOS alike — and Caddy serves **HTTPS on the managed hostname** with it. Use **Full (strict)** in Cloudflare (`scripts/cloudflare-bootstrap.ts` sets it).
- **Without** it: Caddy serves the managed hostname with `tls internal` (self-signed), which only works with Cloudflare SSL mode **Full** — a Full (strict) zone answers it with a 526.

Agent boxes install **pinned** versions of OpenClaw, Hermes, Open WebUI and Caddy (constants in `src/lib/runtimes/`, see [`docs/RUNTIMES.md`](../docs/RUNTIMES.md#version-pinning-srclibruntime-versionsts)). `OPENCLAW_VERSION` / `HERMES_VERSION` / `OPEN_WEBUI_VERSION` / `CADDY_VERSION` in `.env` override a pin without a code deploy. Caddy comes from its GitHub release, not the Cloudsmith apt repo, which has answered `402` since 2026-10-09.

## 9. Google Drive backups (per-agent)

Users can back up an agent's settings to their **own** Google Drive and restore them later. This reuses the existing **`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`** (the feature is hidden when Google OAuth isn't configured), via a dedicated consent flow separate from login.

In the Google Cloud console for that OAuth client:

- Add the Drive **Authorized redirect URI**: `<NEXT_PUBLIC_APP_URL>/api/integrations/drive/callback` (override with **`GOOGLE_DRIVE_REDIRECT_URI`** if needed). This is in addition to the NextAuth login callback `/api/auth/callback/google`.
- On the **OAuth consent screen**, add the scope `https://www.googleapis.com/auth/drive.file` (app-created files only — minimal access).

Backups contain agent **settings only** (config, persona, skills, model tier, interface) — never secrets, IPs, or tokens. The encrypted Drive refresh token is stored with **`INSTANCE_ENCRYPTION_KEY`** (same key used for other instance secrets). v1 "restore as a new agent" provisions on the free tier; use "restore in place" for existing paid agents.

## 10. Custom dashboard domains (per-team white-label)

Teams on **Enterprise** can serve the dashboard on their own domain (e.g. `app.agency.com`). TLS for these third-party domains is handled by **Cloudflare for SaaS (Custom Hostnames)** — Cloudflare's edge terminates TLS and proxies to your origin. No Caddy on-demand TLS, no per-domain cert issuance in the app.

**Platform setup (one-time):**

1. Enable **Cloudflare for SaaS** on a zone in your platform Cloudflare account and configure a **fallback origin** pointing at the app server (set **`WHITELABEL_FALLBACK_ORIGIN`**).
2. Set env:
   - **`CLOUDFLARE_API_TOKEN`** — token with **SSL and Certificates: Edit** (plus the existing DNS scopes) on that zone.
   - **`CLOUDFLARE_SAAS_ZONE_ID`** — the SaaS-enabled zone id (falls back to `CLOUDFLARE_ZONE_ID` if unset).
   - **`WHITELABEL_CNAME_TARGET`** — the CNAME target customers point their domain at (the SaaS custom-hostname target).
3. The app registers/polls/deletes custom hostnames via `src/lib/cloudflare-saas.ts`. The canonical dashboard host can stay behind Caddy (`deploy/Caddyfile`) or any proxy.

**Per-team flow** (in `/dashboard/settings/branding`): connect domain → the app registers a Cloudflare custom hostname → add the **CNAME** to `WHITELABEL_CNAME_TARGET` → Cloudflare completes DV and issues the cert. The status route polls Cloudflare and flips DNS/TLS/verified badges; the domain only resolves once Cloudflare reports the cert **active**.

> **Migration:** before retiring the old Caddy on-demand-TLS catch-all, run **`npm run whitelabel:backfill-hostnames`** to register a Cloudflare custom hostname for every already-verified domain — otherwise live tenant domains lose TLS.

**OAuth on custom domains:** provider redirect URIs can't be pre-registered for arbitrary domains, so the login page on a custom host shows **email/password only** — OAuth (Google/Twitter/Apple) stays on the canonical domain. Register OAuth redirect URIs only for the canonical host.

**Downgrade:** entitlement is re-checked live on every branding read, so a team that drops below Enterprise reverts to the default look — its stored config is kept (re-upgrading restores it).

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
