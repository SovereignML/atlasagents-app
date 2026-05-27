// OVHcloud provider adapter — OVH Public Cloud API over signed fetch (no SDK).
//
// OVH is materially more complex than Linode/DO:
//   • Every request is signed: X-Ovh-Signature = "$1$" + sha1(appSecret + "+" +
//     consumerKey + "+" + method + "+" + url + "+" + body + "+" + timestamp).
//   • flavor (plan), image, and ssh key are REGION-SPECIFIC UUIDs. Our
//     normalized plan code is the flavor NAME (e.g. "d2-4"); the adapter
//     resolves name → id per region at create time. Same for the Ubuntu image.
//   • Instances carry no tags. We mark ownership by name prefix ("sovereign-")
//     and synthesize a "sovereignml" tag in listVMs so the reconciler's
//     orphan sweep still works.
//
// Env: OVH_ENDPOINT (default "ovh-eu"), OVH_APP_KEY, OVH_APP_SECRET,
//      OVH_CONSUMER_KEY, OVH_CLOUD_PROJECT_ID.

import { createHash } from "crypto"
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

const ENDPOINTS: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
}

const OWNERSHIP_PREFIX = "sovereign-"
const DEFAULT_IMAGE_NAME = "Ubuntu 24.04"

function baseUrl(): string {
  const ep = process.env.OVH_ENDPOINT ?? "ovh-eu"
  return ENDPOINTS[ep] ?? ENDPOINTS["ovh-eu"]
}

function creds() {
  const appKey = process.env.OVH_APP_KEY
  const appSecret = process.env.OVH_APP_SECRET
  const consumerKey = process.env.OVH_CONSUMER_KEY
  const projectId = process.env.OVH_CLOUD_PROJECT_ID
  if (!appKey || !appSecret || !consumerKey || !projectId) {
    throw new Error(
      "OVH credentials missing — set OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY, OVH_CLOUD_PROJECT_ID",
    )
  }
  return { appKey, appSecret, consumerKey, projectId }
}

type OvhError = Error & { status?: number }

// OVH is strict about clock drift. Sync once against /auth/time and cache the
// delta between their epoch and ours.
let timeDeltaSec: number | null = null
async function ovhTimestamp(): Promise<number> {
  if (timeDeltaSec === null) {
    try {
      const res = await fetch(`${baseUrl()}/auth/time`)
      const serverTime = Number(await res.text())
      timeDeltaSec = serverTime - Math.floor(Date.now() / 1000)
    } catch {
      timeDeltaSec = 0
    }
  }
  return Math.floor(Date.now() / 1000) + timeDeltaSec
}

async function ovhFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { appKey, appSecret, consumerKey } = creds()
  const url = `${baseUrl()}${path}`
  const bodyStr = body === undefined ? "" : JSON.stringify(body)
  const ts = await ovhTimestamp()
  const toSign = `${appSecret}+${consumerKey}+${method}+${url}+${bodyStr}+${ts}`
  const signature = "$1$" + createHash("sha1").update(toSign).digest("hex")

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Ovh-Application": appKey,
      "X-Ovh-Consumer": consumerKey,
      "X-Ovh-Timestamp": String(ts),
      "X-Ovh-Signature": signature,
    },
    body: bodyStr === "" ? undefined : bodyStr,
  })
  if (res.status === 204) return undefined as T
  let parsed: unknown = null
  const raw = await res.text()
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }
  if (!res.ok) {
    const message =
      (parsed as { message?: string } | null)?.message ?? res.statusText
    const err = new Error(`OVH ${res.status}: ${message}`) as OvhError
    err.status = res.status
    throw err
  }
  return parsed as T
}

/** Sanitize an OVH/fetch error to a single line for logs (never leaks signature). */
export function describeOvhError(err: unknown): string {
  const e = err as { message?: string }
  return e?.message ?? String(err)
}

type OvhInstance = {
  id: string
  status: string // ACTIVE | BUILD | ERROR | …
  name?: string
  created?: string
  ipAddresses?: Array<{ ip: string; type: string; version: number }>
}

function publicIpv4(i: OvhInstance): string[] {
  return (i.ipAddresses ?? [])
    .filter((a) => a.version === 4 && a.type === "public")
    .map((a) => a.ip)
}

function instanceToVmInfo(i: OvhInstance): VmInfo {
  const owned = (i.name ?? "").startsWith(OWNERSHIP_PREFIX)
  return {
    id: i.id,
    status: i.status === "ACTIVE" ? "running" : i.status.toLowerCase(),
    ipv4: publicIpv4(i),
    label: i.name,
    // Synthesize the fleet tag from the name so reconciler orphan sweep works.
    tags: owned ? ["sovereignml"] : [],
    created: i.created,
  }
}

/** OVH flavor name prefix → normalized category. */
function ovhFlavorCategory(name: string): NormalizedCategory | null {
  // d2/s1 = discovery/sandbox shared; b2/b3 = general purpose (shared-ish);
  // c2/c3 = CPU-optimized (dedicated); r2 = RAM (dedicated).
  if (/^(d2-|s1-)/.test(name)) return "SHARED_CPU"
  if (/^(b2-|b3-)/.test(name)) return "SHARED_CPU"
  if (/^(c2-|c3-|r2-|i1-)/.test(name)) return "DEDICATED_CPU"
  return null
}

export class OVHProvider implements VpsProvider {
  readonly name = "ovh"

  private project(): string {
    return creds().projectId
  }

  private async resolveFlavorId(flavorName: string, region: string): Promise<string> {
    const flavors = await ovhFetch<Array<{ id: string; name: string }>>(
      "GET",
      `/cloud/project/${this.project()}/flavor?region=${encodeURIComponent(region)}`,
    )
    const match = flavors.find((f) => f.name === flavorName)
    if (!match) {
      throw new Error(`OVH flavor "${flavorName}" not available in region ${region}`)
    }
    return match.id
  }

  private async resolveImageId(imageName: string, region: string): Promise<string> {
    const images = await ovhFetch<Array<{ id: string; name: string }>>(
      "GET",
      `/cloud/project/${this.project()}/image?region=${encodeURIComponent(region)}&osType=linux`,
    )
    const match =
      images.find((i) => i.name === imageName) ??
      images.find((i) => i.name.toLowerCase().includes(imageName.toLowerCase()))
    if (!match) {
      throw new Error(`OVH image "${imageName}" not available in region ${region}`)
    }
    return match.id
  }

  /** Ensure the fleet public key exists in the project; return its id. Idempotent. */
  private async ensureSshKey(publicKey: string, region: string): Promise<string> {
    const keyBody = publicKey.trim().split(/\s+/)[1] ?? publicKey.trim()
    const keys = await ovhFetch<Array<{ id: string; publicKey: string }>>(
      "GET",
      `/cloud/project/${this.project()}/sshkey?region=${encodeURIComponent(region)}`,
    )
    const match = keys.find(
      (k) => (k.publicKey.trim().split(/\s+/)[1] ?? "") === keyBody,
    )
    if (match) return match.id
    const created = await ovhFetch<{ id: string }>(
      "POST",
      `/cloud/project/${this.project()}/sshkey`,
      { name: "sovereign-fleet", publicKey, region },
    )
    return created.id
  }

  async createVM(opts: CreateVmOpts): Promise<VmInfo> {
    const flavorId = await this.resolveFlavorId(opts.plan, opts.region)
    const imageId = await this.resolveImageId(opts.image ?? DEFAULT_IMAGE_NAME, opts.region)
    let sshKeyId: string | undefined
    const fleetKey = opts.authorizedKeys?.[0]
    if (fleetKey) sshKeyId = await this.ensureSshKey(fleetKey, opts.region)

    const created = await ovhFetch<OvhInstance>(
      "POST",
      `/cloud/project/${this.project()}/instance`,
      {
        name: opts.label,
        region: opts.region,
        flavorId,
        imageId,
        sshKeyId,
        userData: opts.userData,
        monthlyBilling: false,
      },
    )
    return instanceToVmInfo(created)
  }

  async deleteVM(id: string): Promise<boolean> {
    try {
      await ovhFetch<void>("DELETE", `/cloud/project/${this.project()}/instance/${id}`)
      return true
    } catch (err) {
      if ((err as OvhError).status === 404) return false
      throw err
    }
  }

  async getVM(id: string): Promise<VmInfo> {
    const inst = await ovhFetch<OvhInstance>(
      "GET",
      `/cloud/project/${this.project()}/instance/${id}`,
    )
    return instanceToVmInfo(inst)
  }

  async getVMOrNull(id: string): Promise<VmInfo | null> {
    try {
      return await this.getVM(id)
    } catch (err) {
      if ((err as OvhError).status === 404) return null
      throw err
    }
  }

  async listVMs(filter?: { tag?: string }): Promise<VmInfo[]> {
    const list = await ovhFetch<OvhInstance[]>(
      "GET",
      `/cloud/project/${this.project()}/instance`,
    )
    const infos = list.map(instanceToVmInfo)
    if (filter?.tag) return infos.filter((i) => (i.tags ?? []).includes(filter.tag!))
    return infos
  }

  async listPlans(): Promise<NormalizedPlan[]> {
    // Flavors are region-scoped; dedupe by name across regions for the catalog.
    const flavors = await ovhFetch<
      Array<{
        name: string
        vcpus: number
        ram: number // MB
        disk: number // GB
        planCodes?: { monthly?: string }
      }>
    >("GET", `/cloud/project/${this.project()}/flavor`)
    const seen = new Set<string>()
    const out: NormalizedPlan[] = []
    for (const f of flavors) {
      if (seen.has(f.name)) continue
      const category = ovhFlavorCategory(f.name)
      if (!category) continue
      seen.add(f.name)
      out.push({
        providerPlanCode: f.name,
        category,
        vcpu: f.vcpus,
        ramGb: Math.round(f.ram / 1024),
        diskGb: f.disk,
        // OVH flavor endpoint doesn't return a clean USD price; pricing is
        // configured in src/configs/providers.ts. Left 0 here.
        monthlyCostUsd: 0,
      })
    }
    return out
  }

  async getRegions(): Promise<ProviderRegionInfo[]> {
    const regions = await ovhFetch<string[]>(
      "GET",
      `/cloud/project/${this.project()}/region`,
    )
    return regions.map((code) => ({ code, name: code }))
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      await ovhFetch<unknown>("GET", `/cloud/project/${this.project()}`)
      const latencyMs = Date.now() - started
      return { status: latencyMs > 4000 ? "degraded" : "up", latencyMs }
    } catch (err) {
      return { status: "down", latencyMs: null, detail: { error: describeOvhError(err) } }
    }
  }

  async getRemainingCredit(): Promise<number | null> {
    return getRemainingCreditBySlug(this.name)
  }
}
