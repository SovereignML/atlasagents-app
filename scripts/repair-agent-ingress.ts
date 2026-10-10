// Repair the public ingress of agents that are ALREADY RUNNING.
//
// The October 2026 deploy fixes (Caddy from its GitHub release, version pins,
// origin certs installed over SSH, the OpenClaw proxy-trust fix) apply to every
// agent provisioned after the app is redeployed. Two of the defects they fix
// also live on boxes provisioned before that, and a redeploy of the app does
// not reach those:
//
//   1. Warm-pool agents were delivered without a Cloudflare origin certificate,
//      so Caddy serves the managed hostname with `tls internal`. Behind a zone
//      in Full (strict) that is a 526 for every visitor.
//   2. OpenClaw agents list only 127.0.0.1 in gateway.trustedProxies, while
//      Caddy reaches the gateway over ::1. Every openclaw release we install
//      rejects that as proxy_attribution_required: every browser request to
//      the agent URL is a 403, even though the box reports healthy.
//
// For each running agent with a managed hostname this:
//   - installs the origin cert for the hostname's own zone (when one is
//     configured) and re-renders the Caddyfile if that changes it — a
//     graceful reload, Caddy keeps the old config if the new one is invalid;
//   - OpenClaw only: adds "::1" to gateway.trustedProxies. The gateway
//     hot-applies proxy trust; if the probe still sees a 403 it is restarted.
//
// Nothing else is touched: no env rewrite, no key rotation, no runtime restart
// beyond that one fallback.
//
// Usage:
//   node --env-file=.env --import tsx scripts/repair-agent-ingress.ts             # dry run: read-only probes
//   node --env-file=.env --import tsx scripts/repair-agent-ingress.ts --apply
//   node --env-file=.env --import tsx scripts/repair-agent-ingress.ts --apply --instance <id>
//
// DEFAULTS TO DRY RUN. The dry run still connects to each box over SSH, but
// only reads.

import { db, instances, eq, and, inArray, isNotNull } from "@/db"
import { getRuntime } from "@/lib/runtimes"
import { sshTargetForInstance } from "@/lib/ssh-target"
import {
  resolveElevation,
  sshInstallCaddyfile,
  sshRun,
  sshVmHasCloudflareOriginCerts,
  type SshTarget,
} from "@/lib/ssh"
import { ensureManagedOriginCert } from "@/lib/agent-origin-cert"
import { originCertFor, zoneForHostname } from "@/lib/agent-zones"
import { toolServicesForIds } from "@/configs/agent-tools"

const APPLY = process.argv.includes("--apply")
const onlyIdx = process.argv.indexOf("--instance")
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null

type Row = typeof instances.$inferSelect

/** Rewrites openclaw.json in place to trust both loopback addresses. Prints "patched" or "ok". */
function trustedProxiesPatch(configPath: string): string {
  const js = `
const fs = require("fs")
const p = ${JSON.stringify(configPath)}
const c = JSON.parse(fs.readFileSync(p, "utf8"))
c.gateway = c.gateway || {}
const t = new Set(c.gateway.trustedProxies || [])
const before = t.size
t.add("127.0.0.1"); t.add("::1")
if (t.size !== before) {
  c.gateway.trustedProxies = [...t]
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\\n")
  console.log("patched")
} else {
  console.log("ok")
}`
  return `node -e ${shellQuote(js)}`
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** HTTP status a Caddy-shaped request gets from the gateway (forwarded headers, from ::1). */
async function proxiedStatus(target: SshTarget, port: number): Promise<string> {
  const r = await sshRun(
    target,
    `curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'X-Forwarded-For: 203.0.113.9' -H 'X-Forwarded-Proto: https' 'http://[::1]:${port}/' || echo 000`,
  )
  return r.stdout.trim() || "000"
}

async function repair(row: Row): Promise<string[]> {
  const notes: string[] = []
  const runtime = getRuntime(row.runtime)
  const target = sshTargetForInstance(row)
  if (!target.host) return ["no host — skipped"]
  if (row.deploymentTarget === "byos") target.elevate = await resolveElevation(target)

  // --- 1. Origin cert + Caddyfile -------------------------------------
  const host = row.managedSubdomain
  if (host) {
    const zone = zoneForHostname(host)
    const certConfigured = zone ? Boolean(originCertFor(zone)) : false
    const hasCert = await sshVmHasCloudflareOriginCerts(target)
    const current = (await sshRun(target, "cat /etc/caddy/Caddyfile 2>/dev/null || true")).stdout
    const servesInternal = new RegExp(`${host.replace(/\./g, "\\.")} \\{\\s*\\n\\s*tls internal`).test(current)
    notes.push(
      `zone=${zone?.domain ?? "none"} certConfigured=${certConfigured} boxHasCert=${hasCert} servesTlsInternal=${servesInternal}`,
    )
    if (APPLY && certConfigured) {
      const outcome = await ensureManagedOriginCert(target, host)
      if (outcome.warning) notes.push(`WARN ${outcome.warning}`)
      const webuiEnabled = Boolean(row.webuiEnabled) && Boolean(runtime.sidecar)
      const caddy = runtime.renderCaddyfile({
        domain: row.domain,
        managedSubdomain: host,
        useCfOriginTls: outcome.useCfOriginTls,
        domainUseInternalTls: Boolean(row.domain) && row.domainProxied,
        upstreamPort: webuiEnabled && runtime.sidecar ? runtime.sidecar.port : undefined,
        toolServices: toolServicesForIds(row.enabledTools ?? []).map((s) => ({
          pathPrefix: s.caddyPathPrefix,
          port: s.port,
        })),
      })
      if (caddy.trim() !== current.trim()) {
        const res = await sshInstallCaddyfile(target, caddy)
        notes.push(
          res.code === 0 || res.code === null
            ? `caddyfile re-rendered (useCfOriginTls=${outcome.useCfOriginTls})`
            : `WARN caddy reload exit ${res.code}: ${(res.stderr || res.stdout).trim().slice(0, 200)}`,
        )
      } else {
        notes.push("caddyfile unchanged")
      }
    }
  }

  // --- 2. OpenClaw proxy trust ----------------------------------------
  if (runtime.id === "openclaw") {
    const before = await proxiedStatus(target, runtime.gatewayPort)
    notes.push(`openclaw proxied status before=${before}`)
    if (APPLY && before === "403") {
      const owner = runtime.paths.systemUser
      const res = await sshRun(
        target,
        `${trustedProxiesPatch(runtime.paths.configPath)} && chown ${owner}:${owner} ${shellQuote(runtime.paths.configPath)}`,
      )
      notes.push(`trustedProxies: ${(res.stdout || res.stderr).trim()}`)
      await new Promise((r) => setTimeout(r, 3000))
      let after = await proxiedStatus(target, runtime.gatewayPort)
      if (after === "403") {
        await sshRun(target, `systemctl restart ${runtime.serviceName}`)
        for (let i = 0; i < 20 && (after === "403" || after === "000"); i++) {
          await new Promise((r) => setTimeout(r, 2000))
          after = await proxiedStatus(target, runtime.gatewayPort)
        }
        notes.push(`restarted ${runtime.serviceName}`)
      }
      notes.push(`openclaw proxied status after=${after}`)
    }
  }
  return notes
}

async function main() {
  const rows = await db.query.instances.findMany({
    where: and(
      eq(instances.status, "running"),
      inArray(instances.deploymentTarget, ["vps", "byos"]),
      isNotNull(instances.ipAddress),
      ...(ONLY ? [eq(instances.id, ONLY)] : []),
    ),
  })
  console.log(
    `${rows.length} running agent(s)${APPLY ? "" : " — DRY RUN (read-only probes); pass --apply to repair"}`,
  )
  let failed = 0
  for (const row of rows) {
    try {
      const notes = await repair(row)
      console.log(`  ${row.id}  ${row.runtime ?? "openclaw"}  ${row.managedSubdomain ?? "-"}\n    ${notes.join("\n    ")}`)
    } catch (err) {
      failed++
      console.log(`  ${row.id}  FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failed) console.log(`${failed} agent(s) could not be reached or repaired.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
