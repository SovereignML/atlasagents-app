import { db, cloudflareConnections, eq } from "@/db"
import { decryptSecret } from "./crypto-secret"

const CF_API = "https://api.cloudflare.com/client/v4"

export type CloudflareError = Error & {
  status?: number
  code?: number
  retryAfter?: number
}

/**
 * Per-call Cloudflare context. When omitted, calls fall back to the PLATFORM
 * env credentials (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID, the legacy
 * agent zone). The managed agent subdomains (src/lib/agent-dns.ts) pass the
 * platform token implicitly and the zone id of the agent zone involved
 * explicitly (src/lib/agent-zones.ts). When a token is provided, the user's
 * own token/zone is used (Bring-Your-Own-Cloudflare).
 */
export type CfCtx = { token?: string; zoneId?: string }

/** Connection / auth errors, mirrored on the Drive integration shape. */
export class CloudflareNotConnectedError extends Error {
  constructor() {
    super("Cloudflare is not connected")
    this.name = "CloudflareNotConnectedError"
  }
}
export class CloudflareAuthError extends Error {
  constructor() {
    super("Cloudflare token is invalid or lacks the required scopes")
    this.name = "CloudflareAuthError"
  }
}

function token(ctx?: CfCtx): string {
  const t = ctx?.token ?? process.env.CLOUDFLARE_API_TOKEN
  if (!t) throw new Error("CLOUDFLARE_API_TOKEN is not set")
  return t
}

export function zoneId(ctx?: CfCtx): string {
  const z = ctx?.zoneId ?? process.env.CLOUDFLARE_ZONE_ID
  if (!z) throw new Error("CLOUDFLARE_ZONE_ID is not set")
  return z
}

type CfBody = {
  success?: boolean
  result?: unknown
  result_info?: {
    page?: number
    per_page?: number
    total_pages?: number
    total_count?: number
  }
  errors?: Array<{ message?: string; code?: number }>
}

/** Low-level request that surfaces the FULL Cloudflare envelope (incl. result_info). */
async function cfRequest(
  path: string,
  init: RequestInit = {},
  ctx?: CfCtx,
): Promise<CfBody> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token(ctx)}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  let body: CfBody = {}
  try {
    body = await res.json()
  } catch {
    // non-JSON; leave body empty so we surface res.statusText
  }
  if (!res.ok || body.success === false) {
    const first = body.errors?.[0]
    const msg = first?.message ?? res.statusText
    const code = first?.code
    const err = new Error(
      `Cloudflare ${res.status}${code ? ` ${code}` : ""}: ${msg}`,
    ) as CloudflareError
    err.status = res.status
    err.code = code
    if (res.status === 429) {
      const ra = res.headers.get("retry-after")
      err.retryAfter = ra ? Number(ra) : 5
    }
    throw err
  }
  return body
}

export async function cfFetch<T>(
  path: string,
  init: RequestInit = {},
  ctx?: CfCtx,
): Promise<T> {
  const body = await cfRequest(path, init, ctx)
  return body.result as T
}

export type DnsRecord = {
  id: string
  name: string
  type: string
  content: string
  proxied: boolean
  ttl: number
}

export async function findRecordByName(
  name: string,
  ctx?: CfCtx,
): Promise<DnsRecord | null> {
  const recs = await cfFetch<DnsRecord[]>(
    `/zones/${zoneId(ctx)}/dns_records?type=A&name=${encodeURIComponent(name)}`,
    {},
    ctx,
  )
  return recs[0] ?? null
}

export async function upsertDnsRecord(
  opts: {
    name: string
    ip: string
    proxied?: boolean
    ttl?: number
  },
  ctx?: CfCtx,
): Promise<DnsRecord> {
  const { name, ip, proxied = true, ttl = 1 } = opts
  const existing = await findRecordByName(name, ctx)
  if (existing) {
    if (
      existing.content === ip &&
      existing.proxied === proxied &&
      existing.type === "A"
    ) {
      return existing
    }
    return cfFetch<DnsRecord>(
      `/zones/${zoneId(ctx)}/dns_records/${existing.id}`,
      {
        method: "PUT",
        body: JSON.stringify({ type: "A", name, content: ip, proxied, ttl }),
      },
      ctx,
    )
  }
  return cfFetch<DnsRecord>(
    `/zones/${zoneId(ctx)}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify({ type: "A", name, content: ip, proxied, ttl }),
    },
    ctx,
  )
}

export async function deleteDnsRecord(id: string, ctx?: CfCtx): Promise<void> {
  await cfFetch(`/zones/${zoneId(ctx)}/dns_records/${id}`, { method: "DELETE" }, ctx)
}

export async function patchZoneSetting(
  setting: string,
  value: string | number | boolean,
  ctx?: CfCtx,
): Promise<void> {
  await cfFetch(
    `/zones/${zoneId(ctx)}/settings/${setting}`,
    {
      method: "PATCH",
      body: JSON.stringify({ value }),
    },
    ctx,
  )
}

// ──────────────────────────────────────────────────────────────────────
// Bring-Your-Own-Cloudflare: user-token operations
// ──────────────────────────────────────────────────────────────────────

/** Verify a pasted token is active. GET /user/tokens/verify. */
export async function verifyToken(
  apiToken: string,
): Promise<{ id: string; status: string }> {
  return cfFetch<{ id: string; status: string }>(
    "/user/tokens/verify",
    {},
    { token: apiToken },
  )
}

export type CfZone = { id: string; name: string; status: string }

/**
 * List every zone the token can see. A scoped token only returns zones it has
 * access to, so this doubles as a Zone:Read smoke-test. Paginates fully.
 */
export async function listZones(apiToken: string): Promise<CfZone[]> {
  const ctx = { token: apiToken }
  const zones: CfZone[] = []
  let page = 1
  // Hard cap pages defensively; zone lists are small in practice.
  for (let i = 0; i < 20; i++) {
    const body = await cfRequest(
      `/zones?per_page=50&page=${page}`,
      {},
      ctx,
    )
    const batch = (body.result as CfZone[] | undefined) ?? []
    for (const z of batch) zones.push({ id: z.id, name: z.name, status: z.status })
    const totalPages = body.result_info?.total_pages ?? 1
    if (page >= totalPages || batch.length === 0) break
    page++
  }
  return zones
}

/** Current zone-wide SSL/TLS mode: "off" | "flexible" | "full" | "strict". */
export async function getZoneSslMode(ctx: CfCtx): Promise<string | null> {
  const result = await cfFetch<{ value?: string }>(
    `/zones/${zoneId(ctx)}/settings/ssl`,
    {},
    ctx,
  )
  return result?.value ?? null
}

// ──────────────────────────────────────────────────────────────────────
// Per-team connection helpers (DB-backed). One Cloudflare connection is
// shared across all members of a team.
// ──────────────────────────────────────────────────────────────────────

export async function getCloudflareConnectionForTeam(teamId: string) {
  return db.query.cloudflareConnections.findFirst({
    where: eq(cloudflareConnections.teamId, teamId),
  })
}

/**
 * Decrypt the team's stored Cloudflare token. Throws CloudflareNotConnectedError
 * when no connection exists (→ 409 so the UI prompts a connect).
 */
export async function getCloudflareTokenForTeam(teamId: string): Promise<string> {
  const conn = await getCloudflareConnectionForTeam(teamId)
  if (!conn) throw new CloudflareNotConnectedError()
  return decryptSecret(conn.apiTokenEnc)
}

/** True for token-level auth failures (revoked / wrong scope). */
export function isCloudflareAuthError(err: unknown): boolean {
  const status = (err as CloudflareError)?.status
  return status === 401 || status === 403
}
