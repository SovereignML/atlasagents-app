import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"

const sshInstallCloudflareOriginCert = vi.fn()
const sshVmHasCloudflareOriginCerts = vi.fn()

vi.mock("@/lib/ssh", () => ({
  sshInstallCloudflareOriginCert: (...a: unknown[]) => sshInstallCloudflareOriginCert(...a),
  sshVmHasCloudflareOriginCerts: (...a: unknown[]) => sshVmHasCloudflareOriginCerts(...a),
}))

const { ensureManagedOriginCert } = await import("./agent-origin-cert")

const {
  ATLASDEPLOY_CERT: NEW_CERT,
  ATLASDEPLOY_KEY: NEW_KEY,
  SOVEREIGNCLAW_CERT: LEGACY_CERT,
  SOVEREIGNCLAW_KEY: LEGACY_KEY,
} = await import("./__fixtures__/origin-certs")

const VARS = {
  CLOUDFLARE_ZONE_ID: "zone-legacy",
  CLOUDFLARE_ORIGIN_CERT_PEM: LEGACY_CERT,
  CLOUDFLARE_ORIGIN_CERT_KEY: LEGACY_KEY,
  CLOUDFLARE_AGENT_DOMAIN: "atlasdeploy.xyz",
  CLOUDFLARE_AGENT_ZONE_ID: "zone-new",
  CLOUDFLARE_AGENT_ORIGIN_CERT_PEM: NEW_CERT,
  CLOUDFLARE_AGENT_ORIGIN_CERT_KEY: NEW_KEY,
}
const ALL = [...Object.keys(VARS), "CLOUDFLARE_BASE_DOMAIN"]
const saved = Object.fromEntries(ALL.map((k) => [k, process.env[k]]))

const target = { host: "203.0.113.10" }
const OK = { stdout: "installed", stderr: "", code: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ALL) delete process.env[k]
  Object.assign(process.env, VARS)
  sshInstallCloudflareOriginCert.mockResolvedValue(OK)
  sshVmHasCloudflareOriginCerts.mockResolvedValue(false)
})
afterEach(() => {
  for (const k of ALL) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("ensureManagedOriginCert()", () => {
  it("does nothing for an agent without a managed hostname", async () => {
    expect(await ensureManagedOriginCert(target, null)).toEqual({ useCfOriginTls: false, zone: null })
    expect(sshInstallCloudflareOriginCert).not.toHaveBeenCalled()
  })

  // The warm-pool gap: a pooled VM never had a cert baked in, so it served
  // `tls internal` — a 526 behind a Full (strict) edge.
  it("installs the cert even when the box has none", async () => {
    const out = await ensureManagedOriginCert(target, "agent-1a2b.atlasdeploy.xyz")
    expect(out).toEqual({ useCfOriginTls: true, zone: "atlasdeploy.xyz" })
    expect(sshInstallCloudflareOriginCert).toHaveBeenCalledWith(target, NEW_CERT, NEW_KEY)
  })

  it("gives an existing agent its own zone's cert after the cutover", async () => {
    await ensureManagedOriginCert(target, "bot-bold-fox.sovereignclaw.xyz")
    expect(sshInstallCloudflareOriginCert).toHaveBeenCalledWith(target, LEGACY_CERT, LEGACY_KEY)
  })

  it("keeps the old behaviour when the zone has no cert configured", async () => {
    delete process.env.CLOUDFLARE_AGENT_ORIGIN_CERT_PEM
    delete process.env.CLOUDFLARE_AGENT_ORIGIN_CERT_KEY
    sshVmHasCloudflareOriginCerts.mockResolvedValue(true)
    const out = await ensureManagedOriginCert(target, "agent-1a2b.atlasdeploy.xyz")
    expect(out.useCfOriginTls).toBe(true)
    expect(sshInstallCloudflareOriginCert).not.toHaveBeenCalled()
  })

  it("falls back, with a warning, when the install fails", async () => {
    sshInstallCloudflareOriginCert.mockResolvedValue({ stdout: "", stderr: "no caddy user", code: 1 })
    const out = await ensureManagedOriginCert(target, "agent-1a2b.atlasdeploy.xyz")
    expect(out.useCfOriginTls).toBe(false)
    expect(out.warning).toMatch(/Could not install the atlasdeploy\.xyz origin certificate \(exit 1\): no caddy user/)
  })

  it("leaves a hostname outside every agent zone alone", async () => {
    const out = await ensureManagedOriginCert(target, "agent.example.com")
    expect(out.zone).toBeNull()
    expect(sshInstallCloudflareOriginCert).not.toHaveBeenCalled()
  })

  it("fails loudly on another zone's cert rather than installing one that cannot serve the hostname", async () => {
    process.env.CLOUDFLARE_AGENT_ORIGIN_CERT_PEM = LEGACY_CERT
    process.env.CLOUDFLARE_AGENT_ORIGIN_CERT_KEY = LEGACY_KEY
    await expect(ensureManagedOriginCert(target, "agent-1a2b.atlasdeploy.xyz")).rejects.toThrow(
      /CLOUDFLARE_AGENT_ORIGIN_CERT_PEM is a certificate for \*\.sovereignclaw\.xyz/,
    )
    expect(sshInstallCloudflareOriginCert).not.toHaveBeenCalled()
  })

  it("fails loudly on a malformed cert rather than serving self-signed", async () => {
    process.env.CLOUDFLARE_AGENT_ORIGIN_CERT_PEM = "nope"
    await expect(ensureManagedOriginCert(target, "agent-1a2b.atlasdeploy.xyz")).rejects.toThrow(
      /CLOUDFLARE_AGENT_ORIGIN_CERT_PEM is set but does not contain valid PEM/,
    )
  })
})
