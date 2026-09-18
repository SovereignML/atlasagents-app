// Pure parsing + verdict logic for the BYOS server preflight — no DB, no SSH,
// no network. Kept separate from byos-server.ts (which pulls in @/db and
// @/lib/ssh) so it can be unit-tested in isolation, mirroring the split between
// server-metrics.ts and server-metrics-parse.ts.
//
// The preflight runs when the customer CONNECTS a server, before any money
// changes hands and before we install anything. It answers two different
// questions, and keeping them apart is the point:
//
//   BLOCKERS  — we cannot run an agent here at all (wrong OS, wrong CPU
//               architecture, no root). Refuse; there is nothing to override.
//   CONFLICTS — we can, but it will disturb something already on the box
//               (:443 in use, a firewall already up, an existing Caddyfile).
//               Surface these with the fix, and let the owner decide.

import { PROBE_SCRIPT, parseServerMetrics, type ServerMetricSnapshot } from "./server-metrics-parse"

/**
 * The hardware probe plus the compatibility facts we need before installing.
 * Appended to PROBE_SCRIPT so one SSH session answers everything.
 *
 * Runs unprivileged. `ss`/`lsof` without root still report that a port is bound
 * (just not always which process owns it), which is all the verdict needs, and
 * `sudo -n true` is the only privilege question asked.
 */
export const PREFLIGHT_SCRIPT = `${PROBE_SCRIPT}
os_id=""; os_codename=""
if [ -r /etc/os-release ]; then . /etc/os-release; os_id="$ID"; os_codename="\${VERSION_CODENAME:-}"; fi
echo "os_id=$os_id"
echo "os_codename=$os_codename"
echo "arch=$(uname -m 2>/dev/null)"
echo "uid=$(id -u 2>/dev/null)"
if [ "$(id -u 2>/dev/null)" = "0" ]; then echo "sudo_ok=1"; else
  if sudo -n true 2>/dev/null; then echo "sudo_ok=1"; else echo "sudo_ok=0"; fi
fi
echo "ssh_port=$(grep -oP '^\\s*Port\\s+\\K[0-9]+' /etc/ssh/sshd_config 2>/dev/null | head -1)"
listening() { ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | grep -qx "$1" && echo 1 || echo 0; }
echo "port80_busy=$(listening 80)"
echo "port443_busy=$(listening 443)"
echo "has_caddy=$( [ -f /etc/caddy/Caddyfile ] && echo 1 || echo 0 )"
echo "has_nginx=$( command -v nginx >/dev/null 2>&1 && echo 1 || echo 0 )"
echo "has_apache=$( command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1 && echo 1 || echo 0 )"
echo "ufw_active=$( ufw status 2>/dev/null | head -1 | grep -qi 'Status: active' && echo 1 || echo 0 )"
echo "has_swap=$( awk 'NR>1 {print $1}' /proc/swaps 2>/dev/null | head -1 | grep -q . && echo 1 || echo 0 )"
echo "disk_avail_gb=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')"
`

/** Distro families whose bootstrap we actually implement (apt-based). */
const SUPPORTED_OS_IDS = ["ubuntu", "debian"]
/** The only CPU architecture we ship for — see `arch` blocker below. */
const SUPPORTED_ARCH = ["x86_64", "amd64"]
/** Room needed for Node + Caddy + Chrome + a runtime, with headroom. */
export const MIN_DISK_AVAIL_GB = 8

export type PreflightFacts = ServerMetricSnapshot & {
  osId: string | null
  osCodename: string | null
  arch: string | null
  uid: number | null
  sudoOk: boolean
  /** Port from sshd_config, when it declares one. Null means the default, 22. */
  sshPort: number | null
  port80Busy: boolean
  port443Busy: boolean
  hasCaddy: boolean
  hasNginx: boolean
  hasApache: boolean
  ufwActive: boolean
  hasSwap: boolean
  diskAvailGb: number | null
}

export type PreflightIssue = {
  /** Stable id so the UI can key fixes/overrides off it. */
  code: string
  /** One sentence, addressed to the server's owner. */
  message: string
  /** What they can do about it. Null when nothing can be done. */
  fix: string | null
}

export type PreflightVerdict = {
  facts: PreflightFacts
  /** Hard stops. Non-empty ⇒ we refuse to connect the server. */
  blockers: PreflightIssue[]
  /** Things we would disturb. Shown with an explicit opt-in, never silent. */
  conflicts: PreflightIssue[]
}

function flag(v: string | undefined): boolean {
  return v?.trim() === "1"
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : null
}

function str(v: string | undefined): string | null {
  const s = v?.trim()
  return s ? s : null
}

export function parsePreflight(stdout: string): PreflightFacts {
  const kv = new Map<string, string>()
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=")
    if (eq === -1) continue
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1))
  }
  return {
    ...parseServerMetrics(stdout),
    osId: str(kv.get("os_id"))?.toLowerCase() ?? null,
    osCodename: str(kv.get("os_codename"))?.toLowerCase() ?? null,
    arch: str(kv.get("arch")),
    uid: num(kv.get("uid")),
    sudoOk: flag(kv.get("sudo_ok")),
    sshPort: num(kv.get("ssh_port")),
    port80Busy: flag(kv.get("port80_busy")),
    port443Busy: flag(kv.get("port443_busy")),
    hasCaddy: flag(kv.get("has_caddy")),
    hasNginx: flag(kv.get("has_nginx")),
    hasApache: flag(kv.get("has_apache")),
    ufwActive: flag(kv.get("ufw_active")),
    hasSwap: flag(kv.get("has_swap")),
    diskAvailGb: num(kv.get("disk_avail_gb")),
  }
}

/**
 * Turn the facts into blockers and conflicts.
 *
 * Note what is deliberately NOT a blocker: an occupied :443, an active
 * firewall, an existing Caddyfile. Those are the owner's call — they may well
 * be running something they intend to move. Refusing outright would be us
 * deciding how they may use their own machine.
 */
export function evaluatePreflight(facts: PreflightFacts): PreflightVerdict {
  const blockers: PreflightIssue[] = []
  const conflicts: PreflightIssue[] = []

  if (!facts.osId || !SUPPORTED_OS_IDS.includes(facts.osId)) {
    blockers.push({
      code: "os_unsupported",
      message: `We can only manage agents on Ubuntu or Debian right now${
        facts.osName ? ` — this server reports ${facts.osName}` : ""
      }.`,
      fix: "Use an Ubuntu or Debian server, or deploy a managed agent instead.",
    })
  }

  // amd64-only is not a new restriction: the browser tool installs Google
  // Chrome from an arch=amd64 apt repo and Google publishes no arm64 .deb, so
  // an arm64 box would fail partway through the install instead of here.
  if (!facts.arch || !SUPPORTED_ARCH.includes(facts.arch.toLowerCase())) {
    blockers.push({
      code: "arch_unsupported",
      message: `We only support 64-bit x86 servers${facts.arch ? ` — this one is ${facts.arch}` : ""}.`,
      fix: "Use an x86_64 server. ARM support isn't available yet.",
    })
  }

  if (!facts.sudoOk) {
    blockers.push({
      code: "no_root",
      message: "This login can't gain root, so we can't install or run the agent's service.",
      fix: "Connect as root, or give this user passwordless sudo (NOPASSWD in sudoers).",
    })
  }

  if (facts.diskAvailGb != null && facts.diskAvailGb < MIN_DISK_AVAIL_GB) {
    blockers.push({
      code: "disk_low",
      message: `Only ${facts.diskAvailGb} GB free on / — an agent needs about ${MIN_DISK_AVAIL_GB} GB.`,
      fix: "Free up disk space and re-check.",
    })
  }

  const webServer = facts.hasNginx ? "nginx" : facts.hasApache ? "Apache" : null
  if (facts.port443Busy || facts.port80Busy) {
    const which = [facts.port80Busy && "80", facts.port443Busy && "443"].filter(Boolean).join(" and ")
    conflicts.push({
      code: "web_ports_busy",
      message: `Port ${which} is already in use${webServer ? ` (${webServer} is installed)` : ""}. We use Caddy on 80 and 443 to serve your agent.`,
      fix: "Free those ports, or continue anyway if you're happy for Caddy to take over the ones it can bind.",
    })
  }

  if (facts.hasCaddy) {
    conflicts.push({
      code: "existing_caddyfile",
      message: "This server already has a Caddyfile. Installing an agent replaces it.",
      fix: "We keep a copy at /etc/caddy/Caddyfile.atlas-orig, but merge anything you still need afterwards.",
    })
  }

  if (facts.ufwActive) {
    conflicts.push({
      code: "ufw_active",
      message: "A firewall (ufw) is active. We'll add allow-rules for SSH, 80 and 443 but won't change anything else.",
      fix: null,
    })
  }

  return { facts, blockers, conflicts }
}

/** True when the server can be connected (conflicts alone never block). */
export function isConnectable(verdict: PreflightVerdict): boolean {
  return verdict.blockers.length === 0
}
