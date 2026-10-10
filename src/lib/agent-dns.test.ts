import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"

const upsertDnsRecord = vi.fn()
const deleteDnsRecord = vi.fn()
const findRecordByName = vi.fn()

vi.mock("./cloudflare", () => ({
  upsertDnsRecord: (...a: unknown[]) => upsertDnsRecord(...a),
  deleteDnsRecord: (...a: unknown[]) => deleteDnsRecord(...a),
  findRecordByName: (...a: unknown[]) => findRecordByName(...a),
}))

const { createAgentSubdomain, deleteAgentSubdomain, isAgentDnsEnabled, isAgentDnsEnabledFor } =
  await import("./agent-dns")

const ALL = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_BASE_DOMAIN",
  "CLOUDFLARE_AGENT_DOMAIN",
  "CLOUDFLARE_AGENT_ZONE_ID",
]
const saved = Object.fromEntries(ALL.map((k) => [k, process.env[k]]))

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ALL) delete process.env[k]
  process.env.CLOUDFLARE_API_TOKEN = "tok"
  process.env.CLOUDFLARE_ZONE_ID = "zone-legacy"
  upsertDnsRecord.mockResolvedValue({ id: "rec-1" })
  deleteDnsRecord.mockResolvedValue(undefined)
  findRecordByName.mockResolvedValue(null)
})
afterEach(() => {
  for (const k of ALL) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function cutover() {
  process.env.CLOUDFLARE_AGENT_DOMAIN = "atlasagents.xyz"
  process.env.CLOUDFLARE_AGENT_ZONE_ID = "zone-new"
}

describe("createAgentSubdomain()", () => {
  it("creates in sovereignclaw.xyz until a new zone is configured", async () => {
    const { name } = await createAgentSubdomain("inst", "203.0.113.10", "My Bot")
    expect(name).toMatch(/^my-bot-[a-z]+-[a-z]+\.sovereignclaw\.xyz$/)
    expect(upsertDnsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ name, ip: "203.0.113.10", proxied: true }),
      { zoneId: "zone-legacy" },
    )
  })

  it("creates new agents in the new zone after the cutover", async () => {
    cutover()
    const { name } = await createAgentSubdomain("agent-1a2b", "203.0.113.10")
    expect(name).toBe("agent-1a2b.atlasagents.xyz")
    expect(upsertDnsRecord).toHaveBeenCalledWith(expect.anything(), { zoneId: "zone-new" })
  })
})

describe("deleteAgentSubdomain()", () => {
  it("deletes an existing agent's record in the zone it was created in", async () => {
    cutover()
    await deleteAgentSubdomain("inst", "rec-old", "bot-bold-fox.sovereignclaw.xyz")
    expect(deleteDnsRecord).toHaveBeenCalledWith("rec-old", { zoneId: "zone-legacy" })
  })

  it("deletes a new agent's record in the new zone", async () => {
    cutover()
    await deleteAgentSubdomain("inst", "rec-new", "agent-1a2b.atlasagents.xyz")
    expect(deleteDnsRecord).toHaveBeenCalledWith("rec-new", { zoneId: "zone-new" })
  })

  it("falls back to a lookup by the real hostname when the record id is gone", async () => {
    deleteDnsRecord.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }))
    findRecordByName.mockResolvedValue({ id: "rec-found" })
    await deleteAgentSubdomain("inst", "rec-stale", "bot-bold-fox.sovereignclaw.xyz")
    expect(findRecordByName).toHaveBeenCalledWith("bot-bold-fox.sovereignclaw.xyz", { zoneId: "zone-legacy" })
    expect(deleteDnsRecord).toHaveBeenLastCalledWith("rec-found", { zoneId: "zone-legacy" })
  })

  it("refuses to touch a hostname in no configured zone", async () => {
    await expect(deleteAgentSubdomain("inst", "rec", "agent.example.com")).rejects.toThrow(
      /not in any configured agent zone/,
    )
    expect(deleteDnsRecord).not.toHaveBeenCalled()
  })
})

describe("isAgentDnsEnabled*", () => {
  it("needs a token and the relevant zone id", () => {
    expect(isAgentDnsEnabled()).toBe(true)
    expect(isAgentDnsEnabledFor("bot.sovereignclaw.xyz")).toBe(true)
    expect(isAgentDnsEnabledFor("agent.example.com")).toBe(false)
    delete process.env.CLOUDFLARE_API_TOKEN
    expect(isAgentDnsEnabled()).toBe(false)
  })
})
