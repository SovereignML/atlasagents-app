import { describe, it, expect } from "vitest"
import {
  LEGACY_AGENT_DOMAIN,
  agentZoneConfigProblems,
  agentZones,
  legacyAgentZone,
  newAgentZone,
  originCertFor,
  primaryAgentZone,
  zoneDnsEnabled,
  zoneForHostname,
} from "./agent-zones"

const CERT = "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n"
const KEY = "-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----\n"
const NEW_CERT = "-----BEGIN CERTIFICATE-----\nNEW\n-----END CERTIFICATE-----\n"
const NEW_KEY = "-----BEGIN PRIVATE KEY-----\nNEWKEY\n-----END PRIVATE KEY-----\n"

/** Production today: the legacy zone only. */
const LEGACY_ONLY = {
  CLOUDFLARE_API_TOKEN: "tok",
  CLOUDFLARE_ZONE_ID: "zone-legacy",
  CLOUDFLARE_ORIGIN_CERT_PEM: CERT,
  CLOUDFLARE_ORIGIN_CERT_KEY: KEY,
}

/** After the cutover: new agents go to atlasagents.xyz, old ones stay put. */
const CUTOVER = {
  ...LEGACY_ONLY,
  CLOUDFLARE_AGENT_DOMAIN: "atlasagents.xyz",
  CLOUDFLARE_AGENT_ZONE_ID: "zone-new",
  CLOUDFLARE_AGENT_ORIGIN_CERT_PEM: NEW_CERT,
  CLOUDFLARE_AGENT_ORIGIN_CERT_KEY: NEW_KEY,
}

describe("agent zones — before any cutover", () => {
  it("keeps every agent in sovereignclaw.xyz, so shipping this changes nothing", () => {
    expect(LEGACY_AGENT_DOMAIN).toBe("sovereignclaw.xyz")
    expect(primaryAgentZone(LEGACY_ONLY)).toMatchObject({
      domain: "sovereignclaw.xyz",
      zoneId: "zone-legacy",
    })
    expect(agentZones(LEGACY_ONLY).map((z) => z.domain)).toEqual(["sovereignclaw.xyz"])
  })

  it("still honours CLOUDFLARE_BASE_DOMAIN for the legacy zone", () => {
    expect(legacyAgentZone({ CLOUDFLARE_BASE_DOMAIN: "Example.COM." }).domain).toBe("example.com")
  })
})

describe("agent zones — after the cutover", () => {
  it("creates new agents in the new zone", () => {
    expect(primaryAgentZone(CUTOVER)).toMatchObject({ domain: "atlasagents.xyz", zoneId: "zone-new" })
  })

  it("keeps both zones live, new first", () => {
    expect(agentZones(CUTOVER).map((z) => z.domain)).toEqual(["atlasagents.xyz", "sovereignclaw.xyz"])
  })

  it("routes an existing agent by its hostname, not by configuration", () => {
    expect(zoneForHostname("bot-bold-fox.sovereignclaw.xyz", CUTOVER)?.zoneId).toBe("zone-legacy")
    expect(zoneForHostname("bot-bold-fox.atlasagents.xyz", CUTOVER)?.zoneId).toBe("zone-new")
  })

  it("does not move the legacy variables, which also back white-label hostnames", () => {
    // cloudflare-saas.ts falls back to CLOUDFLARE_ZONE_ID; the cutover must not need it changed.
    expect(legacyAgentZone(CUTOVER).zoneId).toBe("zone-legacy")
  })

  it("collapses a new zone that is the legacy domain into one", () => {
    const env = { ...CUTOVER, CLOUDFLARE_AGENT_DOMAIN: "sovereignclaw.xyz" }
    expect(agentZones(env)).toHaveLength(1)
  })
})

describe("zoneForHostname()", () => {
  it("matches on a label boundary only", () => {
    expect(zoneForHostname("evilsovereignclaw.xyz", LEGACY_ONLY)).toBeNull()
    expect(zoneForHostname("sovereignclaw.xyz.attacker.com", LEGACY_ONLY)).toBeNull()
  })

  it("is case- and trailing-dot-insensitive", () => {
    expect(zoneForHostname("Bot-Bold-Fox.SovereignClaw.XYZ.", LEGACY_ONLY)?.domain).toBe(
      "sovereignclaw.xyz",
    )
  })

  it("returns null for a custom domain or nothing", () => {
    expect(zoneForHostname("agent.example.com", CUTOVER)).toBeNull()
    expect(zoneForHostname(null, CUTOVER)).toBeNull()
    expect(zoneForHostname("", CUTOVER)).toBeNull()
  })

  it("prefers the longest matching zone", () => {
    const env = { ...LEGACY_ONLY, CLOUDFLARE_AGENT_DOMAIN: "eu.sovereignclaw.xyz", CLOUDFLARE_AGENT_ZONE_ID: "zone-eu" }
    expect(zoneForHostname("bot.eu.sovereignclaw.xyz", env)?.zoneId).toBe("zone-eu")
    expect(zoneForHostname("bot.sovereignclaw.xyz", env)?.zoneId).toBe("zone-legacy")
  })
})

describe("a half-finished cutover", () => {
  it("is ignored rather than thrown on, so DNS cleanup keeps working", () => {
    const env = { ...LEGACY_ONLY, CLOUDFLARE_AGENT_DOMAIN: "atlasagents.xyz" }
    expect(newAgentZone(env)).toBeNull()
    expect(primaryAgentZone(env).domain).toBe("sovereignclaw.xyz")
  })

  it("is reported", () => {
    const problems = agentZoneConfigProblems({ ...LEGACY_ONLY, CLOUDFLARE_AGENT_ZONE_ID: "zone-new" })
    expect(problems.join("\n")).toMatch(/CLOUDFLARE_AGENT_DOMAIN is not set/)
  })
})

describe("originCertFor()", () => {
  it("reads each zone's own cert, never the other zone's", () => {
    const [newZone, legacy] = agentZones(CUTOVER)
    expect(originCertFor(newZone, CUTOVER)).toEqual({ certPem: NEW_CERT, keyPem: NEW_KEY })
    expect(originCertFor(legacy, CUTOVER)).toEqual({ certPem: CERT, keyPem: KEY })
  })

  it("is null when the zone has no cert", () => {
    const env = { ...CUTOVER, CLOUDFLARE_AGENT_ORIGIN_CERT_PEM: "", CLOUDFLARE_AGENT_ORIGIN_CERT_KEY: "" }
    expect(originCertFor(primaryAgentZone(env), env)).toBeNull()
    expect(agentZoneConfigProblems(env).join("\n")).toMatch(/No origin certificate for atlasagents\.xyz/)
  })

  it("turns literal \\n escapes back into newlines", () => {
    const env = {
      ...LEGACY_ONLY,
      CLOUDFLARE_ORIGIN_CERT_PEM: CERT.replace(/\n/g, "\\n"),
      CLOUDFLARE_ORIGIN_CERT_KEY: KEY.replace(/\n/g, "\\n"),
    }
    expect(originCertFor(legacyAgentZone(env), env)).toEqual({ certPem: CERT, keyPem: KEY })
  })

  it("refuses half a pair, which would otherwise serve self-signed behind a strict edge", () => {
    const env = { ...LEGACY_ONLY, CLOUDFLARE_ORIGIN_CERT_KEY: "" }
    expect(() => originCertFor(legacyAgentZone(env), env)).toThrow(/CLOUDFLARE_ORIGIN_CERT_KEY is not set/)
  })

  it("refuses something that is not PEM", () => {
    const env = { ...LEGACY_ONLY, CLOUDFLARE_ORIGIN_CERT_PEM: "not a cert" }
    expect(() => originCertFor(legacyAgentZone(env), env)).toThrow(/does not contain valid PEM/)
  })
})

describe("zoneDnsEnabled()", () => {
  it("needs both a token and the zone id", () => {
    expect(zoneDnsEnabled(legacyAgentZone(LEGACY_ONLY), LEGACY_ONLY)).toBe(true)
    expect(zoneDnsEnabled(legacyAgentZone(LEGACY_ONLY), { ...LEGACY_ONLY, CLOUDFLARE_API_TOKEN: "" })).toBe(false)
    expect(zoneDnsEnabled(legacyAgentZone({ CLOUDFLARE_API_TOKEN: "tok" }), { CLOUDFLARE_API_TOKEN: "tok" })).toBe(false)
    expect(zoneDnsEnabled(null, LEGACY_ONLY)).toBe(false)
  })
})
