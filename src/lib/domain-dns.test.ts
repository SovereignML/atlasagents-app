import { describe, expect, it, vi, beforeEach } from "vitest"

const resolveNs = vi.fn()
const resolve4 = vi.fn()

vi.mock("node:dns/promises", () => ({
  default: {
    resolveNs: (...a: unknown[]) => resolveNs(...a),
    resolve4: (...a: unknown[]) => resolve4(...a),
  },
  resolveNs: (...a: unknown[]) => resolveNs(...a),
  resolve4: (...a: unknown[]) => resolve4(...a),
}))

const { isValidHostname, normalizeHostname, lookupDomainNs, lookupDomainA } =
  await import("./domain-dns")

describe("normalizeHostname / isValidHostname", () => {
  it("strips scheme, path, and trailing dot", () => {
    expect(normalizeHostname("https://Agent.Example.com/path")).toBe("agent.example.com")
    expect(normalizeHostname("example.com.")).toBe("example.com")
  })

  it("accepts normal hostnames", () => {
    expect(isValidHostname("example.com")).toBe(true)
    expect(isValidHostname("agent.example.com")).toBe(true)
  })

  it("rejects junk", () => {
    expect(isValidHostname("not a domain")).toBe(false)
    expect(isValidHostname("localhost")).toBe(false)
    expect(isValidHostname("-bad.com")).toBe(false)
  })
})

describe("lookupDomainNs", () => {
  beforeEach(() => {
    resolveNs.mockReset()
    resolve4.mockReset()
  })

  it("walks to the apex when the subdomain has no NS", async () => {
    resolveNs.mockImplementation(async (name: string) => {
      if (name === "example.com") return ["ns1.example.com", "ns2.example.com"]
      const err = new Error("not found") as Error & { code: string }
      err.code = "ENOTFOUND"
      throw err
    })
    const result = await lookupDomainNs("agent.example.com")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.apex).toBe("example.com")
      expect(result.nameservers).toEqual(["ns1.example.com", "ns2.example.com"])
    }
  })

  it("fails when nothing has NS", async () => {
    resolveNs.mockImplementation(async () => {
      const err = new Error("not found") as Error & { code: string }
      err.code = "ENOTFOUND"
      throw err
    })
    const result = await lookupDomainNs("totally-unregistered-xyz.invalid")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/No nameservers/)
  })
})

describe("lookupDomainA", () => {
  beforeEach(() => {
    resolve4.mockReset()
  })

  it("returns A records", async () => {
    resolve4.mockResolvedValue(["203.0.113.9"])
    await expect(lookupDomainA("agent.example.com")).resolves.toEqual(["203.0.113.9"])
  })

  it("returns [] on NXDOMAIN", async () => {
    resolve4.mockRejectedValue(Object.assign(new Error("nx"), { code: "ENOTFOUND" }))
    await expect(lookupDomainA("missing.example.com")).resolves.toEqual([])
  })
})
