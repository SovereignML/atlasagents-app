# Integrations — Google Drive Backups & BYO Cloudflare

> Two integrations where the user connects **their own** third-party account, and Atlas Agents acts on it with a narrowly-scoped credential: back agents up to **your own Google Drive**, and put agents on subdomains of **your own Cloudflare zones**.

Both follow the same security shape: a minimal scope, the secret stored encrypted (`encryptSecret`, AES-256-GCM), one connection per user, and best-effort revoke on disconnect. Related: [BYOS.md](BYOS.md), [RUNTIMES.md](RUNTIMES.md).

---

## Google Drive agent backups

Snapshot an agent's **settings and behavior** to a JSON file in the user's own Drive, and restore it later — into the same agent or a brand-new one.

### What it does (for users)

1. **Connect Drive** (`/dashboard` instance → backups tab). This runs a **dedicated** Google consent flow, separate from the Google login provider — it requests only the `drive.file` scope, so Atlas Agents can touch **only files it creates**, never the rest of your Drive.
2. **Create a backup.** A timestamped JSON file (`sovereign-backup-<agent>-<timestamp>.json`) is written to your Drive and indexed locally for fast listing.
3. **Restore** a backup in one of two modes:
   - **In place** — overwrite an existing agent's settings.
   - **As a new agent** — recreate the agent from scratch.

Backups capture **settings only — never secrets**. No API keys, server hosts, IPs, tokens, IDs, status, or billing data are ever written to a backup file.

### What's in a backup

The envelope ([`src/lib/agent-backup.ts`](../src/lib/agent-backup.ts)) is a versioned, zod-validated JSON object (`schemaVersion`, `exportedAt`, `sourceInstanceId`, `agent`). The `agent` object is an **explicit allowlist** — the security boundary — of exactly these settings columns:

`name`, `agentType`, `agentConfig`, `soulMd`, `skills`, `modelTier`, `interfaceKind`, `deploymentTarget`, `runtime`.

Anything not on that list (notably any `*Enc` secret column) is structurally excluded, so a new schema column can never silently leak into a backup.

### Restore semantics

On restore, when `agentConfig` is present the **skills and soul are re-derived** from it via the same canonical helpers the deploy path uses (`selectSkills`, `generateSoul`), so a restored agent matches current skill-map/soul logic rather than a stale snapshot.

| Mode | Behavior |
|------|----------|
| **`in_place`** | Overwrites *behavioral* settings only (`name`, `agentType`, `agentConfig`, `soulMd`, `skills`, `modelTier`, `interfaceKind`). Deliberately leaves slug, infrastructure (region/server/host), `deploymentTarget`/`runtime`, secrets, and status untouched — those reflect real provisioned resources. Target must be `running` or `stopped`; if running, the agent's env is re-provisioned live. |
| **`new`** | Creates a fresh agent from the backup. v1 policy: provisions on the **free tier** only (enforces the one-free-agent guard); restoring as a new *paid* agent isn't supported yet — deploy the plan first, then restore in place. **BYOS** agents can't be recreated this way (their server connection isn't in the no-secrets backup) — use in-place onto a reconnected BYOS agent. |

### How it works (for developers)

- **OAuth** ([`src/lib/google-drive.ts`](../src/lib/google-drive.ts)): a raw-fetch wrapper over Google's OAuth2 + Drive v3 REST (no `googleapis` SDK). Scopes `openid email https://www.googleapis.com/auth/drive.file`, `access_type=offline`, `prompt=consent`. Only the **refresh token** is persisted (encrypted); access tokens are minted on demand. The OAuth `state` is HMAC-signed and short-lived (10 min) for CSRF resistance.
- **Drive files** are uploaded multipart with `appProperties` markers (`tag=sovereign_backup`, `instanceId=…`) so list/download/delete only ever touch this app's own files. A dead refresh token (`invalid_grant`) raises `DriveAuthError` (→ 409 reconnect) and the stale connection row is dropped.
- **Routes:** `GET /api/integrations/drive/connect` (→ consent), `GET /api/integrations/drive/callback`, `POST /api/integrations/drive/disconnect`; `GET|POST /api/instances/[instanceId]/backups` (list / create); `POST /api/instances/[instanceId]/backups/[backupId]/restore` (`{ mode: "new" | "in_place", ... }`).
- **Schema:**
  - `DriveConnection` (`driveConnections`) — one per user (unique `userId`): `googleEmail`, `refreshTokenEnc`, `scope`, timestamps.
  - `BackupRecord` (`backupRecords`) — a local index of Drive backups for fast listing + Postgres-side ownership checks: `userId`, `instanceId` (set **null** on agent delete so backups stay restorable-as-new), `driveFileId` (unique), `fileName`, `agentName`, `schemaVersion`, `sizeBytes`. The backup *content* lives in Drive; this row is just the index.
- **Environment:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (or `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`) — Drive backup is available iff Google OAuth is configured. Optional `GOOGLE_DRIVE_REDIRECT_URI` (defaults to `{appUrl}/api/integrations/drive/callback`). The OAuth state is signed with `NEXTAUTH_SECRET` / `AUTH_SECRET` / `INSTANCE_ENCRYPTION_KEY`.

---

## BYO Cloudflare

Let users (agencies, whitelabel customers) put agents on subdomains of **their own** Cloudflare zones, instead of the platform's managed agent-zone subdomains (`*.sovereignclaw.xyz`, or the zone set by `CLOUDFLARE_AGENT_DOMAIN`).

### What it does (for users)

1. **Connect Cloudflare** — paste a **scoped API token**. Required scopes: **Zone:Read** and **Zone:DNS:Edit**, and ideally **Zone Settings:Edit** (so Atlas Agents can set the zone's SSL mode for you). Connect verifies the token is active and smoke-tests Zone:Read by listing your zones.
2. **Assign a domain** to a running agent — pick one of your zones and an optional subdomain label. Atlas Agents creates a **proxied (orange-cloud) A record** pointing at the agent's IP, raises the zone SSL mode to **Full** if it's weaker, and reconfigures the agent's web server.
3. **Remove** the domain to revert the agent back to its managed subdomain / IP.

### How it works (for developers)

- **Token model** ([`src/lib/cloudflare.ts`](../src/lib/cloudflare.ts)): all verbs take an optional `CfCtx { token, zoneId }`. When omitted, calls fall back to the **platform** credentials (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`) that power managed subdomains; when provided, the **user's** token/zone is used. The pasted token is verified (`/user/tokens/verify`), `listZones` doubles as a Zone:Read check, and it's stored encrypted — one per user.
- **Domain assignment** (`POST /api/instances/[instanceId]/cloudflare-domain`, body `{ zoneId, label?, overwrite? }`): the agent's box is reconfigured **first** (Caddy with `tls internal` for the proxied path) so a failure never leaves dangling DNS; then a proxied A record is upserted (`upsertDnsRecord`, `proxied: true`); a stale record from a previous binding is cleaned up; and the zone SSL mode is raised to `full` if it was `off`/`flexible`/unset. A collision with an existing A record returns `409 cloudflare_record_conflict` unless `overwrite` is set. `DELETE` removes the record and reverts to the managed subdomain — clearing the binding locally even if Cloudflare is now disconnected.
- **SSL caveats** surfaced as warnings: a `strict` zone can return error 526 against a self-signed origin; a token lacking Zone Settings:Edit means the user must set "Full" themselves.
- **Schema:** `CloudflareConnection` (`cloudflareConnections`) — one per user (unique `userId`): `apiTokenEnc`, `accountName`, `email`, timestamps. On the `instances` table: `cfZoneId`, `cfUserRecordId`, `domainProxied` (and the shared `domain`, `dnsStatus`, `tlsStatus`).
- **Environment:** `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` are the **platform** credentials for managed subdomains. User tokens are never env vars — they live encrypted in `cloudflareConnections`.
