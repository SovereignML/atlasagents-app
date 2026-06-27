// DigitalOcean provider adapter — DO API v2 over fetch (no SDK).
//
// Notes specific to DO vs Linode:
//   • DO has no root-password-over-API. We inject access by registering the
//     fleet public key once (idempotent) and referencing it on create. The
//     cloud-init `user_data` bootstrap is identical to the other providers.
//   • Droplet create is async: it returns status "new"; the public IP appears
//     once it reaches "active". We normalize "active" → "running" so the shared
//     waitForVmRunning() loop in the provisioner works across providers.

import type {
  VpsProvider,
  CreateVmOpts,
  VmInfo,
  NormalizedPlan,
  NormalizedCategory,
  ProviderRegionInfo,
  ProviderHealth,
} from "@/lib/vm-provider"
import { getRemainingCreditBySlug } from "@/lib/provider-billing"

const DO_API = "https://api.digitalocean.com/v2"
const FLEET_KEY_NAME = "sovereign-fleet"
const DEFAULT_IMAGE = "ubuntu-24-04-x64"

function token(): string {
  const t = process.env.DIGITALOCEAN_API_TOKEN
  if (!t) throw new Error("DIGITALOCEAN_API_TOKEN is not set")
  return t
}

type DoError = Error & { status?: number }

async function doFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${DO_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 204) return undefined as T
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // non-JSON (rare); fall through to statusText
  }
  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ?? res.statusText
    const err = new Error(`DigitalOcean ${res.status}: ${message}`) as DoError
    err.status = res.status
    throw err
  }
  return body as T
}

/** Sanitize a DO/fetch error to a single token-free line for logs. */
export function describeDoError(err: unknown): string {
  const e = err as { message?: string }
  return e?.message ?? String(err)
}

type DoDroplet = {
  id: number
  status: string // new | active | off | archive
  name?: string
  tags?: string[]
  created_at?: string
  networks?: { v4?: Array<{ ip_address: string; type: string }> }
}

function publicIpv4(d: DoDroplet): string[] {
  return (d.networks?.v4 ?? [])
    .filter((n) => n.type === "public")
    .map((n) => n.ip_address)
}

function dropletToVmInfo(d: DoDroplet): VmInfo {
  return {
    id: String(d.id),
    // Normalize so the shared waitForVmRunning() ("running") works uniformly.
    status: d.status === "active" ? "running" : d.status,
    ipv4: publicIpv4(d),
    label: d.name,
    tags: d.tags ?? [],
    created: d.created_at,
  }
}

/** DO size slug prefix → normalized category. */
function doSizeCategory(slug: string): NormalizedCategory | null {
  if (slug.startsWith("s-")) return "SHARED_CPU"
  if (/^(c-|c2-|g-|gd-|m-|m3-|so-)/.test(slug)) return "DEDICATED_CPU"
  return null // gpu / unknown families
}

export class DigitalOceanProvider implements VpsProvider {
  readonly name = "digitalocean"
  readonly supportsCloudInit = true

  /** Register the fleet public key once; return its DO key id. Idempotent. */
  private async ensureFleetKey(publicKey: string): Promise<number> {
    const keyBody = publicKey.trim().split(/\s+/)[1] ?? publicKey.trim()
    const existing = await doFetch<{ ssh_keys: Array<{ id: number; public_key: string }> }>(
      "/account/keys?per_page=200",
    )
    const match = existing.ssh_keys.find(
      (k) => (k.public_key.trim().split(/\s+/)[1] ?? "") === keyBody,
    )
    if (match) return match.id
    try {
      const created = await doFetch<{ ssh_key: { id: number } }>("/account/keys", {
        method: "POST",
        body: JSON.stringify({ name: FLEET_KEY_NAME, public_key: publicKey }),
      })
      return created.ssh_key.id
    } catch (err) {
      // Race or already-registered under a different name — re-list and match.
      const reread = await doFetch<{ ssh_keys: Array<{ id: number; public_key: string }> }>(
        "/account/keys?per_page=200",
      )
      const m = reread.ssh_keys.find(
        (k) => (k.public_key.trim().split(/\s+/)[1] ?? "") === keyBody,
      )
      if (m) return m.id
      throw err
    }
  }

  async createVM(opts: CreateVmOpts): Promise<VmInfo> {
    const sshKeyIds: number[] = []
    for (const pk of opts.authorizedKeys ?? []) {
      sshKeyIds.push(await this.ensureFleetKey(pk))
    }
    const resp = await doFetch<{ droplet: DoDroplet }>("/droplets", {
      method: "POST",
      body: JSON.stringify({
        name: opts.label,
        region: opts.region,
        size: opts.plan,
        image: opts.image ?? DEFAULT_IMAGE,
        ssh_keys: sshKeyIds.length > 0 ? sshKeyIds : undefined,
        user_data: opts.userData,
        tags: opts.tags,
      }),
    })
    return dropletToVmInfo(resp.droplet)
  }

  async deleteVM(id: string): Promise<boolean> {
    try {
      await doFetch<void>(`/droplets/${id}`, { method: "DELETE" })
      return true
    } catch (err) {
      if ((err as DoError).status === 404) return false
      throw err
    }
  }

  async getVM(id: string): Promise<VmInfo> {
    const resp = await doFetch<{ droplet: DoDroplet }>(`/droplets/${id}`)
    return dropletToVmInfo(resp.droplet)
  }

  async getVMOrNull(id: string): Promise<VmInfo | null> {
    try {
      return await this.getVM(id)
    } catch (err) {
      if ((err as DoError).status === 404) return null
      throw err
    }
  }

  async listVMs(filter?: { tag?: string }): Promise<VmInfo[]> {
    const out: VmInfo[] = []
    let page = 1
    while (true) {
      const qs = new URLSearchParams({ per_page: "200", page: String(page) })
      if (filter?.tag) qs.set("tag_name", filter.tag)
      const resp = await doFetch<{
        droplets: DoDroplet[]
        links?: { pages?: { next?: string } }
      }>(`/droplets?${qs.toString()}`)
      for (const d of resp.droplets ?? []) out.push(dropletToVmInfo(d))
      if (!resp.links?.pages?.next || page > 50) break
      page++
    }
    return out
  }

  async listPlans(): Promise<NormalizedPlan[]> {
    const out: NormalizedPlan[] = []
    let page = 1
    while (true) {
      const resp = await doFetch<{
        sizes: Array<{
          slug: string
          vcpus: number
          memory: number // MB
          disk: number // GB
          price_monthly: number
          available: boolean
        }>
        links?: { pages?: { next?: string } }
      }>(`/sizes?per_page=200&page=${page}`)
      for (const s of resp.sizes ?? []) {
        if (!s.available) continue
        const category = doSizeCategory(s.slug)
        if (!category) continue
        out.push({
          providerPlanCode: s.slug,
          category,
          vcpu: s.vcpus,
          ramGb: Math.round(s.memory / 1024),
          diskGb: s.disk,
          monthlyCostUsd: s.price_monthly,
        })
      }
      if (!resp.links?.pages?.next || page > 50) break
      page++
    }
    return out
  }

  async getRegions(): Promise<ProviderRegionInfo[]> {
    const resp = await doFetch<{
      regions: Array<{ slug: string; name: string; available: boolean }>
    }>("/regions?per_page=200")
    return (resp.regions ?? [])
      .filter((r) => r.available)
      .map((r) => ({ code: r.slug, name: r.name }))
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      await doFetch<{ account: unknown }>("/account")
      const latencyMs = Date.now() - started
      return { status: latencyMs > 4000 ? "degraded" : "up", latencyMs }
    } catch (err) {
      return { status: "down", latencyMs: null, detail: { error: describeDoError(err) } }
    }
  }

  async getRemainingCredit(): Promise<number | null> {
    return getRemainingCreditBySlug(this.name)
  }
}
