import { describe, it, expect, vi, beforeEach } from "vitest"

const resolve4 = vi.fn()
const findFirst = vi.fn()
const setSpy = vi.fn()

vi.mock("node:dns", () => ({
  default: { promises: { resolve4: (...a: unknown[]) => resolve4(...a) } },
}))

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "u1", role: "user" } }),
}))

vi.mock("@/lib/effective-user", () => ({
  getEffectiveUserId: async () => "u1",
}))

vi.mock("@/lib/instance-queries", () => ({
  whereUserInstanceVisible: () => ({}),
}))

vi.mock("@/db", () => ({
  eq: () => ({}),
  instances: {},
  db: {
    query: { instances: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    update: () => ({
      set: (v: unknown) => {
        setSpy(v)
        return { where: () => Promise.resolve() }
      },
    }),
  },
}))

const { GET } = await import("./route")

const ORIGIN_IP = "203.0.113.10"
const CF_IP = "104.21.5.5"
const DOMAIN = "agent.example.com"
const MANAGED = "bot-bold-fox.sovereignclaw.xyz"

function instance(over: Record<string, unknown> = {}) {
  return {
    id: "inst_1",
    status: "running",
    ipAddress: ORIGIN_IP,
    domain: null,
    managedSubdomain: null,
    domainProxied: false,
    dnsStatus: "pending",
    tlsStatus: "pending",
    ...over,
  }
}

async function call() {
  const res = await GET({} as never, {
    params: Promise.resolve({ instanceId: "inst_1" }),
  } as never)
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  // TLS probe: pretend the cert is live so tlsStatus tracks dnsStatus.
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })))
})

describe("GET dns-status — which host gets probed", () => {
  it("probes the custom domain, not the managed subdomain, when both are set", async () => {
    // The regression: an instance gets a managed subdomain at provision time, so
    // probing that in preference meant the custom domain was never checked and
    // the UI badges went green off a hostname nobody was waiting for.
    findFirst.mockResolvedValue(
      instance({ domain: DOMAIN, managedSubdomain: MANAGED }),
    )
    resolve4.mockRejectedValue(new Error("NXDOMAIN"))

    const body = await call()

    expect(resolve4).toHaveBeenCalledWith(DOMAIN)
    expect(resolve4).not.toHaveBeenCalledWith(MANAGED)
    expect(body.dnsStatus).toBe("pending")
  })

  it("falls back to the managed subdomain when no custom domain is set", async () => {
    findFirst.mockResolvedValue(instance({ managedSubdomain: MANAGED }))
    resolve4.mockResolvedValue([CF_IP])

    const body = await call()

    expect(resolve4).toHaveBeenCalledWith(MANAGED)
    // Always Cloudflare-proxied, so any A record means live.
    expect(body.dnsStatus).toBe("ready")
  })
})

describe("GET dns-status — proxied vs direct custom domain", () => {
  it("requires an exact origin-IP match for a direct (grey-cloud) domain", async () => {
    findFirst.mockResolvedValue(
      instance({ domain: DOMAIN, managedSubdomain: MANAGED, domainProxied: false }),
    )
    resolve4.mockResolvedValue([ORIGIN_IP])

    expect((await call()).dnsStatus).toBe("ready")
  })

  it("reports propagating when a direct domain resolves elsewhere", async () => {
    findFirst.mockResolvedValue(
      instance({ domain: DOMAIN, managedSubdomain: MANAGED, domainProxied: false }),
    )
    resolve4.mockResolvedValue(["198.51.100.7"])

    expect((await call()).dnsStatus).toBe("propagating")
  })

  it("accepts any A record for a Cloudflare-proxied custom domain", async () => {
    // Proxied hosts resolve to CF anycast, never the origin — an exact-IP match
    // is impossible, so requiring one would leave it stuck on "propagating".
    findFirst.mockResolvedValue(
      instance({ domain: DOMAIN, managedSubdomain: MANAGED, domainProxied: true }),
    )
    resolve4.mockResolvedValue([CF_IP])

    expect((await call()).dnsStatus).toBe("ready")
  })
})

describe("GET dns-status — persistence", () => {
  it("writes the new status back to the instance", async () => {
    findFirst.mockResolvedValue(instance({ domain: DOMAIN }))
    resolve4.mockResolvedValue([ORIGIN_IP])

    await call()

    expect(setSpy).toHaveBeenCalledWith({ dnsStatus: "ready", tlsStatus: "issued" })
  })

  it("returns nulls and probes nothing when no host is configured", async () => {
    findFirst.mockResolvedValue(instance())

    const body = await call()

    expect(resolve4).not.toHaveBeenCalled()
    expect(body.dnsStatus).toBeNull()
    expect(body.tlsStatus).toBeNull()
  })
})
