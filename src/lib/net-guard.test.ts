import { afterEach, describe, it, expect, vi } from "vitest"

const lookup = vi.hoisted(() => vi.fn())
vi.mock("node:dns/promises", () => ({ lookup }))

import { BlockedHostError, resolvePublicHost } from "./net-guard"

describe("resolvePublicHost", () => {
  afterEach(() => {
    lookup.mockReset()
    vi.unstubAllEnvs()
  })

  it("returns a public literal IP unchanged", async () => {
    expect(await resolvePublicHost(" 203.0.113.10 ")).toBe("203.0.113.10")
    expect(lookup).not.toHaveBeenCalled()
  })

  it("refuses private and metadata literals", async () => {
    await expect(resolvePublicHost("10.0.0.5")).rejects.toBeInstanceOf(BlockedHostError)
    await expect(resolvePublicHost("169.254.169.254")).rejects.toBeInstanceOf(BlockedHostError)
  })

  it("returns the vetted address for a hostname, so the caller dials it", async () => {
    lookup.mockResolvedValueOnce([{ address: "198.51.100.7", family: 4 }])
    expect(await resolvePublicHost("byos.example.com")).toBe("198.51.100.7")
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it("refuses a hostname if any record is private", async () => {
    lookup.mockResolvedValueOnce([
      { address: "198.51.100.7", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])
    await expect(resolvePublicHost("rebind.example.com")).rejects.toThrow(/127\.0\.0\.1/)
  })

  it("passes allowlisted hosts through without resolving them", async () => {
    vi.stubEnv("BYOS_HOST_ALLOWLIST", "test-box.internal")
    expect(await resolvePublicHost("test-box.internal")).toBe("test-box.internal")
    expect(lookup).not.toHaveBeenCalled()
  })
})
