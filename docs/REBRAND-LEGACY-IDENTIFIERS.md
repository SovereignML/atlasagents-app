# Legacy identifiers after the Atlas Agents rebrand

**Status: deliberate deferral, not an oversight.**

The product was renamed SovereignML → **Atlas Agents** and moved to
`app.atlasagents.dev`. That rename covered user-visible copy, metadata, domains,
and assets. It deliberately did **not** cover the identifiers below.

Each one is a **wire format**: a string that is already written into something
outside this repo — a provider's resource tags, a customer's DNS zone, a file on
a provisioned box, a user's authenticator app, an object in a storage bucket.
Renaming the constant does not rename the thing it points at; it just stops
matching it.

Every site listed here carries a `LEGACY WIRE FORMAT` comment in the source
pointing back at this file. **Do not "finish the rename" by removing them.**
The org-level `NOT-TO-DO.md` records the same rule.

---

## The general migration shape

Every identifier below follows the same four-step pattern. Read this once, then
the per-identifier sections only note where they deviate.

1. **Dual-read.** Ship a release that recognizes *both* the old and the new
   value. Read paths accept either; write paths still emit the old one.
2. **Dual-write / backfill.** Flip writes to the new value and backfill the
   existing population (retag VMs, rewrite markers, re-register keys). This is
   the step that touches live infrastructure and needs its own runbook.
3. **Verify.** Confirm zero remaining old-format instances *from the provider's
   side*, not from our DB — the whole risk is drift between the two.
4. **Drop the old value.** Only now delete the compatibility branch and the
   `LEGACY WIRE FORMAT` comment.

Steps 1 and 4 are cheap. Step 2 is the real work, and for several of these it is
not worth doing at all — noted per entry.

---

## Fleet and provisioning

### VM tag `sovereignml`

`src/lib/reconciler.ts` (`TAG`), `src/lib/provisioner.ts`,
`src/lib/warm-pool.ts`, `scripts/bake-golden-image.ts`,
`scripts/bootstrap-shared-host.ts`

The reconciler's **orphan sweep** lists provider VMs by this tag and deletes
anything tagged-but-unknown. Renaming the constant without retagging means the
sweep no longer sees the existing fleet: old VMs become invisible (billed,
unmanaged), and the first sweep after a partial retag can consider newly tagged
machines orphans.

**Migration:** dual-read is mandatory and must land *first* — make the sweep
match `["sovereignml", "atlas-agents"]` and require a VM to carry neither before
it is ever considered an orphan. Then retag via the provider API in batches,
reconciling the count against `instances` after each batch. Keep the grace
window (`ORPHAN_GRACE_MS`) generous during the backfill.

**Rollback:** retag back; the dual-read release tolerates both, so no code
rollback is needed.

**Worth doing?** Low value, high risk. A tag is never seen by a customer.

### OpenRouter key label prefix `sovereign-`

`src/lib/reconciler.ts` (`OR_LABEL_PREFIX`),
`src/lib/openrouter-provisioning.ts`, `src/lib/provisioner.ts`
(`Sovereign-OpenClaw-<slug>`)

The reconciler distinguishes *our* OpenRouter keys from any others on the
account by this case-insensitive prefix. A rename strands every live key: they
keep spending but stop being attributed, which breaks usage billing and spend
caps — a **money path**.

**Migration:** dual-read the prefix, then rename labels through the OpenRouter
API. Reconcile total key count before and after; a key that matches neither
prefix must be treated as foreign and left alone.

**Worth doing?** No. Labels are internal, and the failure mode is silent
mis-billing.

### GHCR image `ghcr.io/sovereignml/sovereign-bot-runtime:latest`

`src/lib/provisioner.ts`, `.env.example`

The published image genuinely lives at that path. Moving it means publishing to
a new namespace, repointing `BOT_RUNTIME_IMAGE`, and leaving the old tag
readable until every box that pulls `latest` has been re-provisioned. Note the
`.github/workflows/bot-runtime.yml` referenced by the docs does not exist in
this repo — find the real publisher before touching this.

### SSH fleet key `sovereign-fleet`

`src/lib/providers/digitalocean.ts` (`FLEET_KEY_NAME`)

Already registered on the DigitalOcean account under this name and referenced by
existing droplets. Renaming causes the adapter to auto-register a *second* key
and new VMs to be built with it, while old VMs keep only the first.

**Migration:** register the new name, confirm both are attached, then remove the
old — but there is no benefit, only fleet-wide SSH-access risk.

### `authorized_keys` markers `# sovereignml-user-key BEGIN/END`

`src/lib/ssh.ts`

These delimit the block of customer-supplied public keys **on disk on every
provisioned box**. Key *removal* works by `sed`-deleting between the markers.
Rename them and the old block becomes unmatched and permanently unremovable —
i.e. **revoked keys stay authorized**. This is the sharpest edge on the list.

**Migration:** the `sed` must delete both the old and the new marker pair for at
least one full re-provision cycle before the old pair is dropped. Verify on a
box that has had keys rotated, not a fresh one.

### n8n owner email domain `@sovereignml.local`

`src/lib/provisioner.ts`, `src/app/api/instances/[instanceId]/tools/route.ts`

Synthetic, never delivered to. n8n owner accounts on already-provisioned boxes
were created with these addresses and are looked up by them. Changing it only
affects newly provisioned services; existing ones would need an n8n-side
account rename. No user impact either way.

---

## Customer-visible state

### DNS TXT verification `_sovereignml-verify` / `sovereignml=<nonce>`

`src/lib/domain-verify.ts`

**Customers have already published these records in their own zones.** We cannot
edit them. A rename invalidates every completed *and* pending white-label domain
verification at once, and each affected customer has to be asked to edit DNS.

**Migration:** dual-read both record names indefinitely; only ever emit the new
one for *new* verifications. Never drop the old reader while any verified domain
predates the change — which, in practice, means never.

### 2FA TOTP issuer `SovereignML`

`src/lib/two-factor.ts`, `src/app/api/auth/2fa/route.ts`

The issuer is baked into the `otpauth://` URI at enrollment and stored inside
the user's authenticator app. It is **display-only** — codes still validate — but
there is no way to update an already-enrolled entry.

**Migration:** change the issuer for *new* enrollments only and accept a mixed
population, or force a re-enrollment campaign. Given it is cosmetic and a forced
2FA reset is a security-support burden, changing it for new enrollments only is
the reasonable option if you want it at all.

### Google Drive backup tag `sovereign_backup` and filenames

`src/lib/google-drive.ts` (`BACKUP_TAG`), `src/lib/agent-backup.ts`
(`sovereign-backup-<slug>-<ts>.json`)

Backups live in the **customer's own Drive**, tagged via `appProperties`. The
restore flow finds them by tag. A renamed tag makes every existing backup
invisible to restore, and we cannot rewrite files in someone else's Drive.

**Migration:** dual-read the tag permanently. The filename is cosmetic and can
change independently, since lookup is by tag.

### DB backup filenames `sovereignml-<stamp>.dump`

`src/lib/db-backup.ts`

Objects already in the backup bucket carry this prefix and are listed and
restored by it. Dual-read the prefix when listing; new dumps can use a new name
once listing tolerates both.

### Admin bucket placeholder `sovereign-backups`

`src/app/admin/backups/backups-client.tsx`

A UI placeholder that hints the real bucket name. Harmless to change *only if*
the actual bucket is renamed too — otherwise it becomes misleading advice.

---

## Environment and build identity

### Postgres role and database `sovereignml`

`scripts/bootstrap-pg.sh` (`DB_NAME` / `DB_USER` defaults), `deploy/README.md`

Live on every deployed box. There is **no populated migrations journal** and
`db:generate` / `db:migrate` are banned against a real database (see
`CLAUDE.md`), so this is not a schema migration — it is a manual
`ALTER DATABASE` / `ALTER ROLE` plus a `DATABASE_URL` change, done during a
maintenance window with a verified dump in hand.

**Worth doing?** No. Purely cosmetic, and it is the one item here that can take
the app fully offline.

### npm package name `sovereign`

`package.json`, `package-lock.json`

`.design-sync/config.json` sets `"pkg": "sovereign"` and all 40 preview files
`import … from "sovereign"`. Renaming requires regenerating the design-sync
kit in the same commit. No runtime effect.

### Dev key-derivation seed `sovereignml-dev-key`

`src/lib/instance.ts`

Not a name — **key material**. `sha256("sovereignml-dev-key")` is the fallback
`INSTANCE_ENCRYPTION_KEY` in development. Changing the string changes the
derived key, making every locally dev-encrypted instance secret undecryptable.
Production throws instead of using it, so there is no prod exposure, and no
reason to touch it.

### Seed admin `admin@sovereignml.com`

`src/db/seed.ts`, `scripts/make-admin.ts`

The production admin **account row already exists** with this address. Changing
the default does not migrate it — it creates a second admin on the next seed.
New deployments should set `ADMIN_EMAIL` instead.

---

## The managed agent zone `sovereignclaw.xyz`

`src/lib/agent-zones.ts` (`LEGACY_AGENT_DOMAIN`), `src/lib/agent-dns.ts`,
`src/lib/agent-origin-cert.ts`, `scripts/cloudflare-bootstrap.ts`

The managed agent zone is a **different domain** from the product domain and
was never `sovereignml.com`. Every running agent has a `*.sovereignclaw.xyz`
hostname, a Cloudflare DNS record in that zone, and a Caddy site block for it
on its own box. Customers have those URLs bookmarked and wired into bots.

**Status: step 1 of the migration shape has shipped — new agents can move to a
new zone by configuration alone; existing agents stay where they are.**
`agent-zones.ts` knows two zones: the *agent zone* (`CLOUDFLARE_AGENT_*`) where
new agents are created once it is configured, and the *legacy zone* (the old
`CLOUDFLARE_BASE_DOMAIN` / `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_ORIGIN_CERT_*`)
which keeps serving, renewing and deleting what it already holds. Which zone an
existing agent is in is read off its stored hostname, never off configuration.
The legacy variables keep their exact meaning because `CLOUDFLARE_ZONE_ID` is
also the fallback for white-label custom hostnames (`cloudflare-saas.ts`).

The origin certificate is installed over SSH when an agent is configured, for
the zone its hostname is in (`agent-origin-cert.ts`) — no longer baked into the
bootstrap, i.e. into cloud-init user-data that any process on the droplet can
read back from the metadata service. That is also what finally gives warm-pool
agents a cert: the pool never baked one, so they served `tls internal`, which a
Full (strict) zone answers with a 526.

### Cutover runbook

**Target: `atlasdeploy.xyz`** — registered 2026-08-17, active on Cloudflare in
the platform account (verified 2026-10-11: `macy` / `johnathan` nameservers,
Universal SSL covering `*.atlasdeploy.xyz`, the platform token reads its DNS).
On that date `sovereignclaw.xyz` still held 14 agent A records and both zones
were in SSL mode **Full**. (`atlasagents.xyz`, named here earlier, is someone
else's parked domain.)

1. **Own the domain** and put it on Cloudflare (nameservers on Cloudflare,
   zone active). `dig +short NS <domain>` must show the Cloudflare pair the
   account uses (`macy` / `johnathan`), not a registrar's parking servers.
2. In the new zone: **SSL/TLS → Origin Server → Create Certificate** for
   `*.<domain>` and `<domain>`, 15 years. Keep the PEM and key.
3. Give `CLOUDFLARE_API_TOKEN` **DNS:Edit** and **Zone Settings:Edit** on the
   new zone too (a scoped token only reaches the zones it names).
4. Set `CLOUDFLARE_AGENT_DOMAIN`, `CLOUDFLARE_AGENT_ZONE_ID`,
   `CLOUDFLARE_AGENT_ORIGIN_CERT_PEM`, `CLOUDFLARE_AGENT_ORIGIN_CERT_KEY`.
   **Change nothing else** — the legacy variables still serve every existing
   agent (see *Replacing the zone outright* below for what repointing them
   costs). Then run
   `node --env-file=.env --import tsx scripts/check-agent-zones.ts --live`.
   It prints no secrets; offline it shows which zone new agents use and checks
   each origin cert against its zone (names, key, expiry), and `--live` asks
   Cloudflare (GET only) whether each zone id is that domain's zone, whether
   the token reaches its DNS, and which SSL mode it is in. Provisioning
   refuses the same bad certs, before a VM is paid for.
5. Run `node --env-file=.env --import tsx scripts/cloudflare-bootstrap.ts`. It
   targets the agent zone: Full (strict), Always Use HTTPS, min TLS 1.2, plus a
   wildcard fallback record only if `CLOUDFLARE_FALLBACK_IP` is set. Leave the
   legacy zone in Full until step 8 has given its agents their cert.
6. Restart the app. New agents get `<name>.<domain>`. Warm-pool keys include
   the zone, so the pool retires its old-zone VMs and bakes replacements on
   its own within a few refill passes.
7. Deploy one OpenClaw and one Hermes agent and load both URLs.
8. Run `scripts/repair-agent-ingress.ts` (dry run, then `--apply`): it installs
   the legacy zone's cert on old agents that never got one (warm-pool
   deliveries). After that the legacy zone can go to Full (strict) as well.

**Rollback:** unset the four `CLOUDFLARE_AGENT_*` variables and restart. Agents
created in the new zone keep serving, but the app can no longer manage their
DNS or certs — restore the variables before deleting or reprovisioning them.

**Replacing the zone outright** — pointing `CLOUDFLARE_BASE_DOMAIN` /
`CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_ORIGIN_CERT_*` at the new zone instead of
using `CLOUDFLARE_AGENT_*` — serves new agents just as well, and is fine once
no agent lives in the old zone. Before that, every old agent falls out of
every configured zone: it keeps serving, but deleting it leaves its DNS record
pointing at a released IP, and its cert can no longer be reinstalled. It also
moves white-label custom hostnames when `CLOUDFLARE_SAAS_ZONE_ID` is unset
(Cloudflare for SaaS was not enabled on any zone as of 2026-10-11, so none
existed). `check-agent-zones.ts --live` counts the A records left in
`sovereignclaw.xyz` when nothing names it any more.

**Keep `sovereignclaw.xyz` registered** (currently until 2027-04-26) for as
long as any agent lives in it. Moving existing agents is not implemented and is
not recommended: it changes URLs customers depend on, and would need a
per-agent redirect from the old hostname.

---

## Also not renamed (and never was branded)

`redesigned-giggle` — the pm2 process name, the systemd unit
(`deploy/redesigned-giggle.service`), and the deploy paths `/opt/redesigned-giggle`,
`/var/log/redesigned-giggle`. Already off-brand, unaffected by the rename, and
changing it would mean rewriting the deploy runbook and the units on every box
for no gain.
