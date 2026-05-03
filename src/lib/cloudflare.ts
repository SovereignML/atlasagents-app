const CF_API = "https://api.cloudflare.com/client/v4"

export type CloudflareError = Error & {
  status?: number
  code?: number
  retryAfter?: number
}

function token(): string {
  const t = process.env.CLOUDFLARE_API_TOKEN
  if (!t) throw new Error("CLOUDFLARE_API_TOKEN is not set")
  return t
}

export function zoneId(): string {
  const z = process.env.CLOUDFLARE_ZONE_ID
  if (!z) throw new Error("CLOUDFLARE_ZONE_ID is not set")
  return z
}

export async function cfFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  let body: {
    success?: boolean
    result?: unknown
    errors?: Array<{ message?: string; code?: number }>
  } = {}
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

export async function findRecordByName(name: string): Promise<DnsRecord | null> {
  const recs = await cfFetch<DnsRecord[]>(
    `/zones/${zoneId()}/dns_records?type=A&name=${encodeURIComponent(name)}`,
  )
  return recs[0] ?? null
}

export async function upsertDnsRecord(opts: {
  name: string
  ip: string
  proxied?: boolean
  ttl?: number
}): Promise<DnsRecord> {
  const { name, ip, proxied = true, ttl = 1 } = opts
  const existing = await findRecordByName(name)
  if (existing) {
    if (
      existing.content === ip &&
      existing.proxied === proxied &&
      existing.type === "A"
    ) {
      return existing
    }
    return cfFetch<DnsRecord>(
      `/zones/${zoneId()}/dns_records/${existing.id}`,
      {
        method: "PUT",
        body: JSON.stringify({ type: "A", name, content: ip, proxied, ttl }),
      },
    )
  }
  return cfFetch<DnsRecord>(`/zones/${zoneId()}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "A", name, content: ip, proxied, ttl }),
  })
}

export async function deleteDnsRecord(id: string): Promise<void> {
  await cfFetch(`/zones/${zoneId()}/dns_records/${id}`, { method: "DELETE" })
}

export async function patchZoneSetting(
  setting: string,
  value: string | number | boolean,
): Promise<void> {
  await cfFetch(`/zones/${zoneId()}/settings/${setting}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  })
}
