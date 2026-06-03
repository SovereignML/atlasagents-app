// Google Drive backup integration — thin raw-fetch wrapper around Google's
// OAuth 2.0 + Drive v3 REST APIs. Mirrors the shape of
// src/lib/openrouter-provisioning.ts (a single authenticated fetch helper plus
// typed verbs) rather than pulling in the heavyweight `googleapis` SDK.
//
// Backups land in the USER'S OWN Drive. We use a dedicated consent flow
// (separate from the NextAuth login provider, which has login scopes only)
// requesting `drive.file` with access_type=offline, and persist only the
// refresh token (encrypted). Access tokens are minted on demand here.

import crypto from "node:crypto"
import { db, driveConnections, eq } from "@/db"
import { decryptSecret } from "@/lib/crypto-secret"
import { isGoogleOAuthConfigured } from "@/lib/oauth"
import { BRANDING } from "@/configs/branding"

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"

// `drive.file` only grants access to files this app creates — minimal blast
// radius. `openid email` lets us label the connection with the user's address.
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"].join(" ")

/** appProperties marker so we only ever list/touch files this app created. */
export const BACKUP_TAG = "sovereign_backup"

const TIMEOUT_MS = 15_000

// ──────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────

/** No Drive connection exists for the user → API should map to 409. */
export class DriveNotConnectedError extends Error {
  constructor(message = "Google Drive is not connected.") {
    super(message)
    this.name = "DriveNotConnectedError"
  }
}

/** Refresh token rejected (user revoked access) → API maps to 409 drive_reauth. */
export class DriveAuthError extends Error {
  constructor(message = "Google Drive authorization expired. Reconnect required.") {
    super(message)
    this.name = "DriveAuthError"
  }
}

// ──────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────

/** Drive backup is available iff Google OAuth credentials are configured. */
export function isDriveConfigured(): boolean {
  return isGoogleOAuthConfigured()
}

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID
  if (!v) throw new Error("GOOGLE_CLIENT_ID is not set; Google Drive backup is unavailable.")
  return v
}

function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET is not set; Google Drive backup is unavailable.")
  return v
}

export function driveRedirectUri(): string {
  return (
    process.env.GOOGLE_DRIVE_REDIRECT_URI ??
    `${BRANDING.appUrl}/api/integrations/drive/callback`
  )
}

function stateSecret(): string {
  const v =
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.INSTANCE_ENCRYPTION_KEY
  if (!v) throw new Error("No secret available to sign the Drive OAuth state (set NEXTAUTH_SECRET).")
  return v
}

// ──────────────────────────────────────────────────────────────────────
// OAuth state — signed, short-lived, CSRF-resistant
// ──────────────────────────────────────────────────────────────────────

export type DriveOAuthState = {
  userId: string
  // Team the connection is being authorized for. The callback writes the
  // DriveConnection to this team. Optional so consents minted before this
  // field existed still verify (the callback falls back to the active team).
  teamId?: string
  instanceId?: string
}

const STATE_TTL_MS = 10 * 60_000 // 10 minutes

function b64url(buf: Buffer): string {
  return buf.toString("base64url")
}

/** Encode + HMAC-sign the OAuth state so the callback can trust it. */
export function signDriveState(state: DriveOAuthState): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ ...state, nonce: crypto.randomBytes(8).toString("hex"), ts: Date.now() })),
  )
  const sig = b64url(crypto.createHmac("sha256", stateSecret()).update(payload).digest())
  return `${payload}.${sig}`
}

/** Verify signature + freshness; returns the decoded state or null. */
export function verifyDriveState(raw: string | null): DriveOAuthState | null {
  if (!raw || !raw.includes(".")) return null
  const [payload, sig] = raw.split(".")
  const expected = b64url(crypto.createHmac("sha256", stateSecret()).update(payload).digest())
  // Constant-time compare; lengths must match first.
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId: string
      teamId?: string
      instanceId?: string
      ts: number
    }
    if (!decoded.userId || typeof decoded.ts !== "number") return null
    if (Date.now() - decoded.ts > STATE_TTL_MS) return null
    return { userId: decoded.userId, teamId: decoded.teamId, instanceId: decoded.instanceId }
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────
// OAuth flow
// ──────────────────────────────────────────────────────────────────────

/** Build the Google consent URL the user is redirected to. */
export function buildDriveConsentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // force refresh-token issuance even on re-consent
    include_granted_scopes: "true",
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  let json: TokenResponse & { error?: string; error_description?: string } = {} as never
  try {
    json = await res.json()
  } catch {
    /* leave empty */
  }
  if (!res.ok) {
    // invalid_grant means the refresh token is dead (user revoked / expired).
    if (json.error === "invalid_grant") throw new DriveAuthError()
    throw new Error(`Google token endpoint ${res.status}: ${json.error ?? res.statusText}`)
  }
  return json
}

/** Exchange the authorization code for tokens (one-time, in the callback). */
export async function exchangeDriveCode(code: string): Promise<{
  refreshToken: string | null
  accessToken: string
  scope: string | null
  expiresIn: number
}> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: driveRedirectUri(),
  })
  return {
    refreshToken: json.refresh_token ?? null,
    accessToken: json.access_token,
    scope: json.scope ?? null,
    expiresIn: json.expires_in,
  }
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshDriveAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiresIn: number
}> {
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
  })
  return { accessToken: json.access_token, expiresIn: json.expires_in }
}

/** Best-effort revoke at Google (used on disconnect). Never throws. */
export async function revokeDriveToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.warn("[drive] token revoke failed (ignored):", err instanceof Error ? err.message : err)
  }
}

/** Fetch the connected account's email (for display). Best-effort → null. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { email?: string }
    return json.email ?? null
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────
// Drive REST verbs (require an access token)
// ──────────────────────────────────────────────────────────────────────

async function driveError(res: Response, verb: string): Promise<Error> {
  let msg = res.statusText
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body.error?.message) msg = body.error.message
  } catch {
    /* non-JSON */
  }
  return new Error(`Google Drive ${verb} ${res.status}: ${msg}`)
}

export type DriveFile = {
  id: string
  name: string
  createdTime?: string
  size?: string
  appProperties?: Record<string, string>
}

/** Upload a JSON backup as a Drive file (multipart: metadata + content). */
export async function uploadBackup(
  accessToken: string,
  args: { fileName: string; json: string; appProperties: Record<string, string> },
): Promise<{ fileId: string; size: number }> {
  const boundary = `sovereign-${crypto.randomBytes(12).toString("hex")}`
  const metadata = {
    name: args.fileName,
    mimeType: "application/json",
    appProperties: args.appProperties,
  }
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${args.json}\r\n` +
    `--${boundary}--`

  const res = await fetch(`${DRIVE_UPLOAD}&fields=id,size`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw await driveError(res, "upload")
  const file = (await res.json()) as DriveFile
  return { fileId: file.id, size: Number(file.size ?? 0) }
}

/** List this app's backup files (optionally filtered to one instance). */
export async function listBackups(accessToken: string, instanceId?: string): Promise<DriveFile[]> {
  let q = `appProperties has { key='tag' and value='${BACKUP_TAG}' } and trashed=false`
  if (instanceId) {
    q += ` and appProperties has { key='instanceId' and value='${instanceId}' }`
  }
  const params = new URLSearchParams({
    q,
    spaces: "drive",
    pageSize: "100",
    orderBy: "createdTime desc",
    fields: "files(id,name,createdTime,size,appProperties)",
  })
  const res = await fetch(`${DRIVE_FILES}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw await driveError(res, "list")
  const json = (await res.json()) as { files?: DriveFile[] }
  return json.files ?? []
}

/** Download a backup file's raw content. Throws DriveAuthError on 401/403 file gone. */
export async function downloadBackup(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw await driveError(res, "download")
  return res.text()
}

/** Delete a backup file. A 404 (already gone) is treated as success. */
export async function deleteBackup(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.ok || res.status === 404) return
  throw await driveError(res, "delete")
}

// ──────────────────────────────────────────────────────────────────────
// Connection → access token
// ──────────────────────────────────────────────────────────────────────

/**
 * Resolve a usable Drive access token for a team. Loads the team's shared
 * connection, decrypts the refresh token, and mints a fresh access token. If
 * the refresh token is dead (revoked), the stale connection row is deleted and
 * DriveAuthError is thrown so the caller can prompt re-connect.
 */
export async function getDriveAccessTokenForTeam(teamId: string): Promise<string> {
  const conn = await db.query.driveConnections.findFirst({
    where: eq(driveConnections.teamId, teamId),
  })
  if (!conn) throw new DriveNotConnectedError()

  const refreshToken = decryptSecret(conn.refreshTokenEnc)
  try {
    const { accessToken } = await refreshDriveAccessToken(refreshToken)
    return accessToken
  } catch (err) {
    if (err instanceof DriveAuthError) {
      // Stale grant — drop it so the UI shows "connect" again.
      await db.delete(driveConnections).where(eq(driveConnections.teamId, teamId))
    }
    throw err
  }
}
