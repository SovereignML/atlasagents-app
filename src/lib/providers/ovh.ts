// OVHcloud provider adapter — OVH VPS product over signed fetch (no SDK).
//
// This targets the OVH **VPS** product line (VPS-1/2/3), NOT Public Cloud
// Instances. That makes it materially different from Linode/DO:
//   • Every request is signed: X-Ovh-Signature = "$1$" + sha1(appSecret + "+" +
//     consumerKey + "+" + method + "+" + url + "+" + body + "+" + timestamp).
//   • There is no instant "create" API. A VPS is ORDERED through the cart API
//     (cart -> assign -> add VPS -> configure datacenter+OS -> checkout with
//     autopay) and then DELIVERED asynchronously. The service name isn't known
//     until delivery, so createVM snapshots /vps, checks out, and diffs the list
//     to discover the new service. Checkout charges a full prepaid month and
//     requires a default payment method on the OVH account.
//   • There is no cloud-init. We inject our fleet SSH key + a clean Ubuntu image
//     via POST /vps/{name}/rebuild after delivery; the runtime bootstrap then
//     runs over SSH (supportsCloudInit = false — see the provisioner).
//   • VPS carry no tags. We mark ownership via displayName prefix ("sovereign-")
//     and synthesize a "sovereignml" tag in listVMs so the reconciler's orphan
//     sweep still works.
//   • Termination needs an email-confirmed token, so deleteVM can't instantly
//     destroy a VPS — it disables auto-renew + flags delete-at-expiration as a
//     best-effort so the service lapses at the end of the prepaid month.
//
// Env: OVH_ENDPOINT (default "ovh-us"), OVH_APP_KEY, OVH_APP_SECRET,
//      OVH_CONSUMER_KEY. The consumer key must be authorized for /order/*,
//      /vps/* and /me/sshKey.

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

const DEFAULT_ENDPOINT = "ovh-us"

// OVH subsidiary (billing region) per API endpoint. Drives the cart's
// `ovhSubsidiary` and the public catalog query.
const SUBSIDIARIES: Record<string, string> = {
  "ovh-eu": "FR",
  "ovh-ca": "CA",
  "ovh-us": "US",
}

const OWNERSHIP_PREFIX = "sovereign-"
const FLEET_KEY_NAME = "sovereign-fleet"
const DEFAULT_IMAGE_NAME = "Ubuntu 24.04"
const SSH_KEY_CONFIG_LABELS = ["vps_ssh_key", "ssh_key"]

// VPS ordering + delivery + rebuild are slow and asynchronous; size the internal
// poll loops generously and independently of the provisioner's waitForVmRunning.
const ORDER_DELIVERY_TIMEOUT_MS = 30 * 60_000
const REBUILD_TIMEOUT_MS = 20 * 60_000
const POLL_INTERVAL_MS = 15_000

function endpointName(): string {
  return process.env.OVH_ENDPOINT?.trim() || DEFAULT_ENDPOINT
}

function baseUrl(): string {
  return ENDPOINTS[endpointName()] ?? ENDPOINTS[DEFAULT_ENDPOINT]
}

function subsidiary(): string {
  return SUBSIDIARIES[endpointName()] ?? SUBSIDIARIES[DEFAULT_ENDPOINT]
}

function creds() {
  const appKey = process.env.OVH_APP_KEY
  const appSecret = process.env.OVH_APP_SECRET
  const consumerKey = process.env.OVH_CONSUMER_KEY
  if (!appKey || !appSecret || !consumerKey) {
    throw new Error(
      "OVH credentials missing — set OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY",
    )
  }
  return { appKey, appSecret, consumerKey }
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
    // #region agent log
    fetch('http://127.0.0.1:7305/ingest/880804f1-30d2-40e6-a578-5c94bee7e97e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'52ccd5'},body:JSON.stringify({sessionId:'52ccd5',runId:'pre-fix',hypothesisId:'C,E',location:'src/lib/providers/ovh.ts:ovhFetch',message:'OVH API non-OK response',data:{method,path,status:res.status,detail:String(message).slice(0,300)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Normalized SSH key body (the base64 blob, ignoring the algo prefix + comment). */
function sshKeyBody(publicKey: string): string {
  return publicKey.trim().split(/\s+/)[1] ?? publicKey.trim()
}

// ── VPS resource shapes (subset we use) ──────────────────────────────────

type OvhVps = {
  name: string
  displayName?: string
  state: string // running | installing | rebooting | stopped | ...
}

type OvhRequiredConfig = {
  label: string
  required?: boolean
  allowedValues?: string[]
}

function vpsToVmInfo(vps: OvhVps, ips: string[]): VmInfo {
  const label = vps.displayName ?? vps.name
  const owned = label.startsWith(OWNERSHIP_PREFIX)
  return {
    id: vps.name,
    status: vps.state === "running" ? "running" : vps.state.toLowerCase(),
    ipv4: ips.filter((ip) => ip.includes(".") && !ip.includes(":")),
    label,
    // Synthesize the fleet tag from the displayName so reconciler orphan sweep works.
    tags: owned ? ["sovereignml"] : [],
  }
}

/** OVH VPS plan code → normalized category. The VPS line is all shared CPU. */
function vpsPlanCategory(): NormalizedCategory {
  return "SHARED_CPU"
}

export class OVHProvider implements VpsProvider {
  readonly name = "ovh"
  // OVH VPS has no cloud-init; the provisioner bootstraps over SSH instead.
  readonly supportsCloudInit = false

  // ── low-level /vps reads ───────────────────────────────────────────────

  private async listServiceNames(): Promise<string[]> {
    return ovhFetch<string[]>("GET", "/vps")
  }

  private async getVps(name: string): Promise<OvhVps> {
    return ovhFetch<OvhVps>("GET", `/vps/${encodeURIComponent(name)}`)
  }

  private async getVpsIps(name: string): Promise<string[]> {
    try {
      return await ovhFetch<string[]>("GET", `/vps/${encodeURIComponent(name)}/ips`)
    } catch (err) {
      // IPs aren't attached yet during install — treat as none, not fatal.
      if ((err as OvhError).status === 404) return []
      throw err
    }
  }

  private async hydrate(name: string): Promise<VmInfo> {
    const [vps, ips] = await Promise.all([this.getVps(name), this.getVpsIps(name)])
    return vpsToVmInfo(vps, ips)
  }

  // ── ordering ───────────────────────────────────────────────────────────

  /** Create + assign a cart for this subsidiary; return the cart id. */
  private async createCart(): Promise<string> {
    const cart = await ovhFetch<{ cartId: string }>("POST", "/order/cart", {
      ovhSubsidiary: subsidiary(),
      description: "sovereignml",
    })
    await ovhFetch<unknown>("POST", `/order/cart/${cart.cartId}/assign`)
    return cart.cartId
  }

  /**
   * Resolve the plan code to actually order against the cart's available offers.
   * OVH renames the VPS range yearly ("vps-2025-model1" -> "vps-2026-model1" …),
   * so when the configured code isn't found verbatim we fall back to the same
   * model number under any year (preferring the plain base code over Local-Zone
   * / promo variants). Throws with the live list when nothing matches.
   */
  private async resolvePlanCode(cartId: string, configured: string): Promise<string> {
    const offers = await ovhFetch<Array<{ planCode: string }>>(
      "GET",
      `/order/cart/${cartId}/vps`,
    )
    const codes = offers.map((o) => o.planCode)
    // #region agent log
    fetch('http://127.0.0.1:7305/ingest/880804f1-30d2-40e6-a578-5c94bee7e97e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'52ccd5'},body:JSON.stringify({sessionId:'52ccd5',runId:'pre-fix',hypothesisId:'D',location:'src/lib/providers/ovh.ts:resolvePlanCode',message:'OVH cart VPS offers',data:{configured,subsidiary:subsidiary(),available:codes,exactMatch:codes.includes(configured)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (codes.includes(configured)) return configured

    const model = configured.match(/model-?(\d+)/i)?.[1]
    if (model) {
      const base = new RegExp(`^vps-\\d{4}-model${model}$`, "i")
      const exact = codes.find((c) => base.test(c))
      if (exact) return exact
      const loose = codes.find(
        (c) => new RegExp(`model${model}(\\b|$)`, "i").test(c) && !/percent|\.lz/i.test(c),
      )
      if (loose) return loose
    }

    throw new Error(
      `OVH VPS plan "${configured}" not available for subsidiary ${subsidiary()}. Available: ${codes.join(", ") || "none"}`,
    )
  }

  private async addVpsItem(cartId: string, planCode: string): Promise<number> {
    const item = await ovhFetch<{ itemId: number }>("POST", `/order/cart/${cartId}/vps`, {
      planCode,
      duration: "P1M",
      pricingMode: "default",
      quantity: 1,
    })
    return item.itemId
  }

  /** Resolve the OS configuration value (Ubuntu) from the item's allowed values. */
  private pickOsValue(configs: OvhRequiredConfig[], imageName: string): string {
    const osConfig = configs.find((c) => /(_os$|^vps_os$|os)/i.test(c.label) && /os/i.test(c.label))
    const allowed = osConfig?.allowedValues ?? []
    const lower = imageName.toLowerCase()
    const exact = allowed.find((v) => v.toLowerCase() === lower)
    if (exact) return exact
    const fuzzy =
      allowed.find((v) => v.toLowerCase().includes(lower)) ??
      allowed.find((v) => v.toLowerCase().includes("ubuntu") && v.includes("24.04")) ??
      allowed.find((v) => v.toLowerCase().includes("ubuntu"))
    if (!fuzzy) {
      throw new Error(
        `OVH VPS image "${imageName}" not available. Allowed: ${allowed.join(", ") || "none"}`,
      )
    }
    return fuzzy
  }

  private osLabel(configs: OvhRequiredConfig[]): string {
    return configs.find((c) => /os/i.test(c.label))?.label ?? "vps_os"
  }

  private datacenterLabel(configs: OvhRequiredConfig[]): string {
    return configs.find((c) => /datacenter/i.test(c.label))?.label ?? "vps_datacenter"
  }

  private assertDatacenter(configs: OvhRequiredConfig[], dc: string): void {
    const cfg = configs.find((c) => /datacenter/i.test(c.label))
    const allowed = cfg?.allowedValues
    if (allowed && allowed.length > 0 && !allowed.includes(dc)) {
      throw new Error(
        `OVH VPS datacenter "${dc}" not available. Allowed: ${allowed.join(", ")}`,
      )
    }
  }

  private async postConfig(
    cartId: string,
    itemId: number,
    label: string,
    value: string,
  ): Promise<void> {
    await ovhFetch<unknown>(
      "POST",
      `/order/cart/${cartId}/item/${itemId}/configuration`,
      { label, value },
    )
  }

  /** Poll the VPS list until a service that wasn't there before appears. */
  private async waitForNewService(before: Set<string>): Promise<string> {
    const deadline = Date.now() + ORDER_DELIVERY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const now = await this.listServiceNames()
      const fresh = now.find((n) => !before.has(n))
      if (fresh) return fresh
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(
      `OVH VPS order did not deliver a new service within ${Math.round(ORDER_DELIVERY_TIMEOUT_MS / 60_000)}m`,
    )
  }

  /** Wait until a VPS reports "running" with at least one public IPv4. */
  private async waitForRunning(name: string, timeoutMs: number): Promise<VmInfo> {
    const deadline = Date.now() + timeoutMs
    let last: VmInfo | null = null
    while (Date.now() < deadline) {
      last = await this.hydrate(name)
      if (last.status === "running" && last.ipv4[0]) return last
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(
      `OVH VPS ${name} did not reach "running" with an IP within ${Math.round(timeoutMs / 60_000)}m` +
        (last ? ` (last state: ${last.status})` : ""),
    )
  }

  // ── SSH key (account-level /me/sshKey) ─────────────────────────────────

  /** Ensure the fleet public key exists on the account; return its keyName. */
  private async ensureSshKey(publicKey: string): Promise<string> {
    const wanted = sshKeyBody(publicKey)
    const names = await ovhFetch<string[]>("GET", "/me/sshKey")
    for (const name of names) {
      const k = await ovhFetch<{ keyName: string; key: string }>(
        "GET",
        `/me/sshKey/${encodeURIComponent(name)}`,
      )
      if (sshKeyBody(k.key) === wanted) return k.keyName
    }
    try {
      await ovhFetch<unknown>("POST", "/me/sshKey", {
        keyName: FLEET_KEY_NAME,
        key: publicKey.trim(),
      })
      return FLEET_KEY_NAME
    } catch (err) {
      // Name already taken (race / prior run) — re-read and match by body.
      const reread = await ovhFetch<string[]>("GET", "/me/sshKey")
      for (const name of reread) {
        const k = await ovhFetch<{ keyName: string; key: string }>(
          "GET",
          `/me/sshKey/${encodeURIComponent(name)}`,
        )
        if (sshKeyBody(k.key) === wanted) return k.keyName
      }
      throw err
    }
  }

  /** Reinstall the VPS with a clean Ubuntu image + our fleet key injected. */
  private async rebuildWithKey(name: string, imageName: string, keyName: string): Promise<void> {
    const images = await ovhFetch<Array<{ id: string; name: string }>>(
      "GET",
      `/vps/${encodeURIComponent(name)}/images/available`,
    )
    const lower = imageName.toLowerCase()
    const image =
      images.find((i) => i.name.toLowerCase() === lower) ??
      images.find((i) => i.name.toLowerCase().includes(lower)) ??
      images.find((i) => i.name.toLowerCase().includes("ubuntu") && i.name.includes("24.04")) ??
      images.find((i) => i.name.toLowerCase().includes("ubuntu"))
    if (!image) {
      throw new Error(
        `OVH VPS ${name}: image "${imageName}" not available for rebuild. Have: ${images.map((i) => i.name).join(", ")}`,
      )
    }
    await ovhFetch<unknown>("POST", `/vps/${encodeURIComponent(name)}/rebuild`, {
      imageId: image.id,
      sshKey: keyName,
      doNotSendPassword: true,
    })
  }

  private async setDisplayName(name: string, displayName: string): Promise<void> {
    try {
      await ovhFetch<unknown>("PUT", `/vps/${encodeURIComponent(name)}`, { displayName })
    } catch {
      // Non-fatal — ownership detection degrades but provisioning can proceed.
    }
  }

  // ── VpsProvider surface ────────────────────────────────────────────────

  async createVM(opts: CreateVmOpts): Promise<VmInfo> {
    const imageName = opts.image ?? DEFAULT_IMAGE_NAME
    const fleetKey = opts.authorizedKeys?.[0]

    // #region agent log
    fetch('http://127.0.0.1:7305/ingest/880804f1-30d2-40e6-a578-5c94bee7e97e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'52ccd5'},body:JSON.stringify({sessionId:'52ccd5',runId:'pre-fix',hypothesisId:'A,B',location:'src/lib/providers/ovh.ts:createVM',message:'OVH createVM entry',data:{endpoint:endpointName(),subsidiary:subsidiary(),plan:opts.plan,region:opts.region,hasAppKey:!!process.env.OVH_APP_KEY,hasAppSecret:!!process.env.OVH_APP_SECRET,hasConsumerKey:!!process.env.OVH_CONSUMER_KEY,fleetKey:!!fleetKey},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // 1. Snapshot existing services so we can spot the delivered one.
    const before = new Set(await this.listServiceNames())

    // 2-7. Build + configure the cart.
    const cartId = await this.createCart()
    const planCode = await this.resolvePlanCode(cartId, opts.plan)
    const itemId = await this.addVpsItem(cartId, planCode)

    const configs = await ovhFetch<OvhRequiredConfig[]>(
      "GET",
      `/order/cart/${cartId}/item/${itemId}/requiredConfiguration`,
    )
    this.assertDatacenter(configs, opts.region)
    await this.postConfig(cartId, itemId, this.datacenterLabel(configs), opts.region)
    await this.postConfig(
      cartId,
      itemId,
      this.osLabel(configs),
      this.pickOsValue(configs, imageName),
    )

    // Some VPS offers expose an SSH-key configuration at order time; use it when
    // present so the delivered VPS already trusts our fleet key (avoids a rebuild
    // round-trip). Otherwise we inject the key via /rebuild after delivery.
    let keyName: string | undefined
    let keySetAtOrder = false
    if (fleetKey) {
      keyName = await this.ensureSshKey(fleetKey)
      const sshConfig = configs.find((c) => SSH_KEY_CONFIG_LABELS.includes(c.label))
      if (sshConfig) {
        await this.postConfig(cartId, itemId, sshConfig.label, keyName)
        keySetAtOrder = true
      }
    }

    // 8. Check out with autopay (charges a full prepaid month immediately).
    await ovhFetch<unknown>("GET", `/order/cart/${cartId}/checkout`)
    await ovhFetch<{ orderId?: number }>("POST", `/order/cart/${cartId}/checkout`, {
      autoPayWithPreferredPaymentMethod: true,
      waiveRetractationPeriod: true,
    })

    // 9. Wait for delivery, then claim ownership via displayName ASAP so the
    //    reconciler orphan sweep can see it even if later steps fail.
    const serviceName = await this.waitForNewService(before)
    await this.setDisplayName(serviceName, opts.label)

    // 10. Ensure our fleet key + a clean Ubuntu image are in place.
    if (fleetKey && keyName && !keySetAtOrder) {
      await this.waitForRunning(serviceName, ORDER_DELIVERY_TIMEOUT_MS)
      await this.rebuildWithKey(serviceName, imageName, keyName)
    }

    // 11. Final: running + IP.
    return this.waitForRunning(serviceName, REBUILD_TIMEOUT_MS)
  }

  async deleteVM(id: string): Promise<boolean> {
    // OVH VPS can't be destroyed via API without an email-confirmed termination
    // token. Best-effort: disable auto-renew + delete at expiration so it lapses
    // at the end of the prepaid month, and surface that manual termination is
    // still required for an immediate teardown.
    try {
      const info = await ovhFetch<{ serviceId: number }>(
        "GET",
        `/vps/${encodeURIComponent(id)}/serviceInfos`,
      )
      await ovhFetch<unknown>("PUT", `/vps/${encodeURIComponent(id)}/serviceInfos`, {
        renew: { automatic: false, deleteAtExpiration: true, forced: false },
      })
      void info
      console.warn(
        `[ovh] deleteVM(${id}): set auto-renew off + delete-at-expiration. ` +
          "OVH VPS cannot be terminated immediately via API (requires an " +
          "email-confirmed token); it will lapse at the end of the prepaid month.",
      )
      return true
    } catch (err) {
      if ((err as OvhError).status === 404) return false
      throw err
    }
  }

  async getVM(id: string): Promise<VmInfo> {
    return this.hydrate(id)
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
    const names = await this.listServiceNames()
    const infos = await Promise.all(names.map((n) => this.hydrate(n)))
    if (filter?.tag) return infos.filter((i) => (i.tags ?? []).includes(filter.tag!))
    return infos
  }

  async listPlans(): Promise<NormalizedPlan[]> {
    const catalog = await ovhFetch<{
      plans?: Array<{
        planCode: string
        blobs?: {
          technical?: {
            cpu?: { cores?: number }
            memory?: { size?: number } // MB
            storage?: { disks?: Array<{ capacity?: number }> } // GB
          }
        }
      }>
    }>("GET", `/order/catalog/public/vps?ovhSubsidiary=${subsidiary()}`)

    const out: NormalizedPlan[] = []
    for (const p of catalog.plans ?? []) {
      const tech = p.blobs?.technical
      if (!tech) continue
      const ramMb = tech.memory?.size ?? 0
      const diskGb = tech.storage?.disks?.[0]?.capacity ?? 0
      out.push({
        providerPlanCode: p.planCode,
        category: vpsPlanCategory(),
        vcpu: tech.cpu?.cores ?? 0,
        ramGb: Math.round(ramMb / 1024),
        diskGb,
        // The catalog price shape is messy; pricing is configured in
        // src/configs/providers.ts. Left 0 here (catalog/admin use only).
        monthlyCostUsd: 0,
      })
    }
    return out
  }

  async getRegions(): Promise<ProviderRegionInfo[]> {
    // VPS datacenters aren't exposed by a simple list endpoint (they're per-offer
    // configuration values), so return the curated set we map in
    // src/configs/providers.ts. US first to match the OVH-US focus.
    return [
      { code: "US-EAST-VA", name: "US East (Vint Hill, VA)" },
      { code: "US-WEST-OR", name: "US West (Hillsboro, OR)" },
      { code: "BHS", name: "Canada (Beauharnois)" },
      { code: "GRA", name: "France (Gravelines)" },
      { code: "SBG", name: "France (Strasbourg)" },
      { code: "DE", name: "Germany (Frankfurt)" },
      { code: "UK", name: "UK (London)" },
      { code: "WAW", name: "Poland (Warsaw)" },
      { code: "SGP", name: "Singapore" },
      { code: "SYD", name: "Australia (Sydney)" },
    ]
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      await this.listServiceNames()
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
