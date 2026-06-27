import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The adapter imports getRemainingCreditBySlug from provider-billing, which pulls
// in @/db (throws without DATABASE_URL). Mock it so the unit test stays DB-free.
vi.mock("@/lib/provider-billing", () => ({
  getRemainingCreditBySlug: vi.fn(async () => null),
}))

import { OVHProvider, describeOvhError } from "./ovh"

type FetchRes = {
  status: number
  ok: boolean
  statusText: string
  text: () => Promise<string>
}

function res(body: unknown, status = 200): FetchRes {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "ERR",
    text: async () =>
      body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
  }
}

/** Extract the API path (after `/1.0`, query stripped) from a full OVH URL. */
function apiPath(url: string): string {
  const i = url.indexOf("/1.0")
  const tail = i >= 0 ? url.slice(i + 4) : url
  return tail.split("?")[0]
}

type Handler = (method: string, path: string, body: unknown) => FetchRes | undefined

function installFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase()
    const path = apiPath(url)
    if (path === "/auth/time") return res("1700000000") as unknown as Response
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const out = handler(method, path, body)
    if (!out) throw new Error(`unhandled OVH call: ${method} ${path}`)
    return out as unknown as Response
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const SERVICE = "vpstest.vps.ovh.us"

beforeEach(() => {
  process.env.OVH_ENDPOINT = "ovh-us"
  process.env.OVH_APP_KEY = "ak"
  process.env.OVH_APP_SECRET = "as"
  process.env.OVH_CONSUMER_KEY = "ck"
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("OVHProvider.createVM (VPS order flow)", () => {
  it("orders, discovers the delivered service, rebuilds with the fleet key, and returns a running VmInfo", async () => {
    let vpsListCalls = 0
    let orderedPlanCode: string | undefined
    let displayNameSet: string | undefined
    let rebuilt = false

    installFetch((method, path, body) => {
      // VPS list: empty snapshot first, then the delivered service.
      if (method === "GET" && path === "/vps") {
        vpsListCalls++
        return res(vpsListCalls === 1 ? [] : [SERVICE])
      }
      if (method === "GET" && path === `/vps/${SERVICE}/ips`) return res(["1.2.3.4", "::1"])
      if (method === "GET" && path === `/vps/${SERVICE}/images/available`)
        return res([{ id: "img-ubuntu", name: "Ubuntu 24.04" }])
      if (method === "POST" && path === `/vps/${SERVICE}/rebuild`) {
        rebuilt = true
        return res({ id: 1 })
      }
      if (method === "PUT" && path === `/vps/${SERVICE}`) {
        displayNameSet = (body as { displayName?: string }).displayName
        return res({})
      }
      if (method === "GET" && path === `/vps/${SERVICE}`)
        return res({ name: SERVICE, displayName: "sovereign-vps-abc", state: "running" })

      if (method === "POST" && path === "/order/cart") return res({ cartId: "cart1" })
      if (method === "POST" && path === "/order/cart/cart1/assign") return res({})
      if (method === "GET" && path === "/order/cart/cart1/vps")
        return res([{ planCode: "vps-2025-model1" }])
      if (method === "POST" && path === "/order/cart/cart1/vps") {
        orderedPlanCode = (body as { planCode?: string }).planCode
        return res({ itemId: 42 })
      }
      if (method === "GET" && path === "/order/cart/cart1/item/42/requiredConfiguration")
        return res([
          { label: "vps_datacenter", required: true, allowedValues: ["US-EAST-VA", "US-WEST-OR"] },
          { label: "vps_os", required: true, allowedValues: ["Debian 12", "Ubuntu 24.04"] },
        ])
      if (method === "POST" && path === "/order/cart/cart1/item/42/configuration") return res({})
      if (method === "GET" && path === "/order/cart/cart1/checkout") return res({})
      if (method === "POST" && path === "/order/cart/cart1/checkout") return res({ orderId: 9 })

      if (method === "GET" && path === "/me/sshKey") return res([])
      if (method === "POST" && path === "/me/sshKey") return res({})
      return undefined
    })

    const provider = new OVHProvider()
    const vm = await provider.createVM({
      label: "sovereign-vps-abc",
      plan: "vps-2025-model1",
      region: "US-EAST-VA",
      rootPassword: "pw",
      authorizedKeys: ["ssh-ed25519 AAAAKEYBODY comment"],
    })

    expect(vm.id).toBe(SERVICE)
    expect(vm.status).toBe("running")
    expect(vm.ipv4).toEqual(["1.2.3.4"]) // IPv6 filtered out
    expect(orderedPlanCode).toBe("vps-2025-model1")
    expect(displayNameSet).toBe("sovereign-vps-abc")
    expect(rebuilt).toBe(true)
  })

  it("tolerates OVH's yearly plan-code rename by matching the model number", async () => {
    let vpsListCalls = 0
    let orderedPlanCode: string | undefined

    installFetch((method, path, body) => {
      if (method === "GET" && path === "/vps") {
        vpsListCalls++
        return res(vpsListCalls === 1 ? [] : [SERVICE])
      }
      if (method === "GET" && path === `/vps/${SERVICE}/ips`) return res(["9.9.9.9"])
      if (method === "GET" && path === `/vps/${SERVICE}/images/available`)
        return res([{ id: "img", name: "Ubuntu 24.04" }])
      if (method === "POST" && path === `/vps/${SERVICE}/rebuild`) return res({ id: 1 })
      if (method === "PUT" && path === `/vps/${SERVICE}`) return res({})
      if (method === "GET" && path === `/vps/${SERVICE}`)
        return res({ name: SERVICE, displayName: "sovereign-x", state: "running" })

      if (method === "POST" && path === "/order/cart") return res({ cartId: "cart1" })
      if (method === "POST" && path === "/order/cart/cart1/assign") return res({})
      // Catalog only has the 2027 code; configured code is the (older) 2025 one.
      if (method === "GET" && path === "/order/cart/cart1/vps")
        return res([{ planCode: "vps-2027-model2" }, { planCode: "vps-2027-model2.LZ" }])
      if (method === "POST" && path === "/order/cart/cart1/vps") {
        orderedPlanCode = (body as { planCode?: string }).planCode
        return res({ itemId: 7 })
      }
      if (method === "GET" && path === "/order/cart/cart1/item/7/requiredConfiguration")
        return res([
          { label: "vps_datacenter", allowedValues: ["US-EAST-VA"] },
          { label: "vps_os", allowedValues: ["Ubuntu 24.04"] },
        ])
      if (method === "POST" && path === "/order/cart/cart1/item/7/configuration") return res({})
      if (method === "GET" && path === "/order/cart/cart1/checkout") return res({})
      if (method === "POST" && path === "/order/cart/cart1/checkout") return res({ orderId: 1 })
      if (method === "GET" && path === "/me/sshKey") return res([])
      if (method === "POST" && path === "/me/sshKey") return res({})
      return undefined
    })

    const provider = new OVHProvider()
    await provider.createVM({
      label: "sovereign-x",
      plan: "vps-2025-model2",
      region: "US-EAST-VA",
      rootPassword: "pw",
      authorizedKeys: ["ssh-ed25519 AAAAKEYBODY c"],
    })

    // Falls back to the plain base code, not the Local-Zone (.LZ) variant.
    expect(orderedPlanCode).toBe("vps-2027-model2")
  })

  it("throws a clear error when no plan code matches the catalog", async () => {
    installFetch((method, path) => {
      if (method === "GET" && path === "/vps") return res([])
      if (method === "POST" && path === "/order/cart") return res({ cartId: "cart1" })
      if (method === "POST" && path === "/order/cart/cart1/assign") return res({})
      if (method === "GET" && path === "/order/cart/cart1/vps")
        return res([{ planCode: "vps-2025-model5" }])
      return undefined
    })

    const provider = new OVHProvider()
    await expect(
      provider.createVM({
        label: "x",
        plan: "vps-2025-model1",
        region: "US-EAST-VA",
        rootPassword: "pw",
      }),
    ).rejects.toThrow(/not available/i)
  })
})

describe("OVHProvider lifecycle reads", () => {
  it("listVMs tags only fleet-owned services and filters by tag", async () => {
    installFetch((method, path) => {
      if (method === "GET" && path === "/vps") return res(["a", "b"])
      if (method === "GET" && path === "/vps/a")
        return res({ name: "a", displayName: "sovereign-vps-1", state: "running" })
      if (method === "GET" && path === "/vps/b")
        return res({ name: "b", displayName: "someone-else", state: "running" })
      if (method === "GET" && path === "/vps/a/ips") return res(["1.1.1.1"])
      if (method === "GET" && path === "/vps/b/ips") return res(["2.2.2.2"])
      return undefined
    })

    const provider = new OVHProvider()
    const all = await provider.listVMs()
    expect(all).toHaveLength(2)
    const owned = await provider.listVMs({ tag: "sovereignml" })
    expect(owned.map((v) => v.id)).toEqual(["a"])
  })

  it("deleteVM disables auto-renew (returns true) and reports 404 as false", async () => {
    installFetch((method, path) => {
      if (method === "GET" && path === "/vps/svc/serviceInfos") return res({ serviceId: 5 })
      if (method === "PUT" && path === "/vps/svc/serviceInfos") return res({})
      if (method === "GET" && path === "/vps/missing/serviceInfos") return res(null, 404)
      return undefined
    })

    const provider = new OVHProvider()
    await expect(provider.deleteVM("svc")).resolves.toBe(true)
    await expect(provider.deleteVM("missing")).resolves.toBe(false)
  })

  it("getVMOrNull returns null on 404", async () => {
    installFetch((method, path) => {
      if (method === "GET" && path === "/vps/gone/ips") return res([], 404)
      if (method === "GET" && path === "/vps/gone") return res({ message: "not found" }, 404)
      return undefined
    })
    const provider = new OVHProvider()
    expect(await provider.getVMOrNull("gone")).toBeNull()
  })
})

describe("describeOvhError", () => {
  it("returns the message without leaking internals", () => {
    expect(describeOvhError(new Error("OVH 400: bad"))).toBe("OVH 400: bad")
    expect(describeOvhError("raw string")).toBe("raw string")
  })
})
