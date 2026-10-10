import { describe, it, expect, vi, beforeEach } from "vitest"

const sshInstallCaddyfile = vi.fn()
const sshRun = vi.fn()
const sshWriteFile = vi.fn()
const ensureManagedOriginCert = vi.fn()

vi.mock("@/lib/ssh", () => ({
  sshInstallCaddyfile: (...a: unknown[]) => sshInstallCaddyfile(...a),
  sshRun: (...a: unknown[]) => sshRun(...a),
  sshWriteFile: (...a: unknown[]) => sshWriteFile(...a),
}))

vi.mock("@/lib/agent-origin-cert", () => ({
  ensureManagedOriginCert: (...a: unknown[]) => ensureManagedOriginCert(...a),
}))

vi.mock("@/lib/crypto-secret", () => ({
  decryptSecret: () => "gateway-token",
}))

vi.mock("@/lib/model-router", () => ({
  routeModel: () => ({ model: "anthropic/claude-sonnet-4", fallback: "anthropic/claude-haiku-4" }),
}))

const { reconfigureInstanceIngress } = await import("./instance-ingress")

const OK = { stdout: "", stderr: "", code: 0 }

type InstanceLike = Parameters<typeof reconfigureInstanceIngress>[0]

function instance(over: Record<string, unknown> = {}): InstanceLike {
  return {
    id: "inst_1",
    ipAddress: "203.0.113.10",
    runtime: "hermes",
    webuiEnabled: true,
    managedSubdomain: null,
    gatewayTokenEnc: "enc",
    modelTier: "mid",
    tlsStatus: null,
    ...over,
  } as unknown as InstanceLike
}

/** The Caddyfile content handed to sshInstallCaddyfile on the last call. */
function renderedCaddyfile(): string {
  const call = sshInstallCaddyfile.mock.calls.at(-1)
  return (call?.[1] as string) ?? ""
}

beforeEach(() => {
  vi.clearAllMocks()
  sshInstallCaddyfile.mockResolvedValue(OK)
  sshRun.mockResolvedValue(OK)
  sshWriteFile.mockResolvedValue(OK)
  ensureManagedOriginCert.mockResolvedValue({ useCfOriginTls: false, zone: null })
})

describe("reconfigureInstanceIngress() — Hermes", () => {
  it("never hand-writes config.yaml for a runtime that manages its own config", async () => {
    // Hermes drives `hermes config set` via its own CLI; renderConfig is only a
    // fallback stub. Writing it would wipe toolsets / terminal.backend /
    // browser.provider / model.base_url and then restart the service.
    await reconfigureInstanceIngress(instance(), {
      domain: "agent.example.com",
      proxied: false,
    })
    expect(sshWriteFile).not.toHaveBeenCalled()
  })

  it("keeps the Open WebUI route on the public host when a domain is set", async () => {
    await reconfigureInstanceIngress(instance(), {
      domain: "agent.example.com",
      proxied: false,
    })
    const caddy = renderedCaddyfile()
    expect(caddy).toContain("handle /v1/*")
    expect(caddy).toContain("reverse_proxy localhost:8080")
  })

  it("serves a self-signed cert for a Cloudflare-proxied domain", async () => {
    await reconfigureInstanceIngress(instance(), {
      domain: "agent.example.com",
      proxied: true,
    })
    expect(renderedCaddyfile()).toContain("tls internal")
  })

  it("refreshes WEBUI_URL without re-rendering the sidecar env file", async () => {
    await reconfigureInstanceIngress(instance(), {
      domain: "agent.example.com",
      proxied: false,
    })
    const cmds = sshRun.mock.calls.map((c) => String(c[1]))
    const patch = cmds.find((c) => c.includes("WEBUI_URL"))
    expect(patch).toBeDefined()
    expect(patch).toContain("agent.example.com")
    // A full re-render of the sidecar env would reset ENABLE_SIGNUP=true and
    // reopen public signup on the agent's chat UI.
    expect(patch).not.toContain("ENABLE_SIGNUP")
    expect(sshWriteFile).not.toHaveBeenCalled()
  })

  it("drops back to the managed subdomain when the domain is cleared", async () => {
    await reconfigureInstanceIngress(
      instance({ managedSubdomain: "bot-bold-fox.sovereignclaw.xyz" }),
      { domain: null, proxied: false },
    )
    const caddy = renderedCaddyfile()
    expect(caddy).toContain("bot-bold-fox.sovereignclaw.xyz {")
    expect(caddy).toContain("handle /v1/*")
  })

  // A domain change re-renders the managed site block too, so it must carry
  // the origin cert for the hostname's own zone, not whatever the box had.
  it("serves the managed hostname with the origin cert the helper installed", async () => {
    ensureManagedOriginCert.mockResolvedValue({ useCfOriginTls: true, zone: "sovereignclaw.xyz" })
    await reconfigureInstanceIngress(
      instance({ managedSubdomain: "bot-bold-fox.sovereignclaw.xyz" }),
      { domain: null, proxied: false },
    )
    expect(ensureManagedOriginCert).toHaveBeenCalledWith(
      expect.anything(),
      "bot-bold-fox.sovereignclaw.xyz",
    )
    expect(renderedCaddyfile()).toContain("tls /etc/caddy/cf/origin.pem /etc/caddy/cf/origin.key")
  })

  it("surfaces a Caddy reload failure instead of silently continuing", async () => {
    sshInstallCaddyfile.mockResolvedValue({ stdout: "", stderr: "bad config", code: 1 })
    await expect(
      reconfigureInstanceIngress(instance(), { domain: "agent.example.com", proxied: false }),
    ).rejects.toThrow(/Caddy reload failed/)
  })
})

describe("reconfigureInstanceIngress() — OpenClaw (no regression)", () => {
  const openclaw = () =>
    instance({ runtime: "openclaw", webuiEnabled: false })

  it("still re-renders the gateway config", async () => {
    // OpenClaw does NOT manage its own config — rewriting it is what recomputes
    // controlUi.allowedOrigins for the new domain.
    await reconfigureInstanceIngress(openclaw(), {
      domain: "agent.example.com",
      proxied: false,
    })
    expect(sshWriteFile).toHaveBeenCalledTimes(1)
  })

  it("uses a single upstream and touches no sidecar", async () => {
    await reconfigureInstanceIngress(openclaw(), {
      domain: "agent.example.com",
      proxied: false,
    })
    expect(renderedCaddyfile()).not.toContain("handle /v1/*")
    const cmds = sshRun.mock.calls.map((c) => String(c[1]))
    expect(cmds.some((c) => c.includes("WEBUI_URL"))).toBe(false)
  })
})
