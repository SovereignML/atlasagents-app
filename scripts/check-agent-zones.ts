// Read-only check of the agent-zone configuration in .env: which zone new
// agents will be created in, which zones existing agents are served from, and
// anything half-configured. Prints domains, zone ids and whether each zone has
// an origin cert — never the cert or key themselves. Touches no network.
//
// Usage:
//   node --env-file=.env --import tsx scripts/check-agent-zones.ts
//
// Exits 1 when something needs fixing, so it can gate a deploy.

import {
  agentZoneConfigProblems,
  agentZones,
  originCertFor,
  primaryAgentZone,
} from "@/lib/agent-zones"

function main(): number {
  const primary = primaryAgentZone()
  console.log(`New agents are created in:  ${primary.domain}  (zone ${primary.zoneId ?? "NOT SET"})`)
  console.log("Zones agents are served from:")
  for (const zone of agentZones()) {
    let cert: string
    try {
      cert = originCertFor(zone) ? "origin cert set" : "NO origin cert"
    } catch {
      cert = "origin cert INVALID"
    }
    console.log(`  ${zone.domain.padEnd(24)} zone ${zone.zoneId ?? "NOT SET"}  ${cert}  (${zone.certVars.cert})`)
  }
  console.log(`CLOUDFLARE_API_TOKEN: ${process.env.CLOUDFLARE_API_TOKEN?.trim() ? "set" : "NOT SET"}`)

  const problems = agentZoneConfigProblems()
  if (problems.length === 0) {
    console.log("\nOK — no problems found.")
    return 0
  }
  console.log("\nProblems:")
  for (const p of problems) console.log(`  - ${p}`)
  return 1
}

process.exit(main())
