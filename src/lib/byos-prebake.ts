/**
 * BYOS connect-time prebake — the work that does not depend on which agent the
 * customer eventually deploys, moved off the deploy path.
 *
 * A BYOS box gets no warm pool: without this, every deploy builds from scratch
 * inside the window the customer is sitting and watching. This installs the
 * same universal image the warm pool bakes (runtimes/universal.ts: Hermes, the
 * CLI engines, AgentWebUI Lite and every engine's ACP side) in the background,
 * the moment the customer connects the server, so the later deploy only writes
 * config, starts the chosen engine and health-checks.
 *
 * OpenClaw is not offered on BYOS, so it is not prebaked. No engine's unit is
 * written: which one runs is decided at deploy, exactly as at a pool claim.
 */

import { buildBakeFinalizeScript } from "@/lib/runtimes/finalize"
import {
  UNIVERSAL_POOL_RUNTIME,
  renderUniversalBootstrap,
  universalMinNode,
} from "@/lib/runtimes/universal"
import { LITE_BIN } from "@/lib/runtimes/agentwebui-lite"
import type { PreflightFacts } from "@/lib/byos-preflight-parse"

/** Mirrors `byosServers.prebakeStatus`. */
export type PrebakeStatus = "none" | "running" | "ready" | "failed" | "skipped"

/**
 * Disk a prebaked box needs beyond the preflight's general floor: shared
 * prereqs + the universal image (every engine but OpenClaw, and Lite), on a
 * machine that is also running whatever the customer already runs.
 */
export const PREBAKE_DISK_REQUIRED_GB = 12

/** The Node major every prebaked box gets: the universal image's, which every BYOS engine accepts. */
export function prebakeMinNode(): string {
  return universalMinNode()
}

export type PrebakeDecision =
  | { run: true; installCaddy: boolean }
  | { run: false; status: "skipped"; reason: string }

/**
 * Whether to prebake this server, and how.
 *
 * Pure so it can be unit-tested and so the connect UI can explain itself
 * before anything is touched.
 *
 * Connecting a server is the go-ahead: there is no separate opt-in. The one
 * thing held back is Caddy on a box that already serves the web (a busy :443,
 * or Caddy, nginx or Apache present). The preflight surfaces those as the
 * owner's call at install time, and installing Caddy in the background would
 * answer it for them; everything else still installs.
 */
export function prebakeDecision(opts: {
  facts: Pick<
    PreflightFacts,
    "port443Busy" | "hasCaddy" | "hasNginx" | "hasApache" | "diskAvailGb"
  >
}): PrebakeDecision {
  const { facts } = opts
  if (facts.diskAvailGb != null && facts.diskAvailGb < PREBAKE_DISK_REQUIRED_GB) {
    return {
      run: false,
      status: "skipped",
      reason:
        `Preinstalling needs about ${PREBAKE_DISK_REQUIRED_GB}GB free and this ` +
        `server has ${facts.diskAvailGb}GB. Deploying will still work; it will ` +
        "just take longer.",
    }
  }

  // An existing Caddy is fine to keep (the bootstrap keeps a new enough one);
  // nginx, Apache or something else on :443 means Caddy waits for the deploy.
  const servesWeb = facts.hasNginx || facts.hasApache || (facts.port443Busy && !facts.hasCaddy)
  return { run: true, installCaddy: !servesWeb && !facts.hasCaddy }
}

export type PrebakeScriptOpts = {
  /** Resolved Hermes pin. Null falls back to its code pin, as the deploy does. */
  hermesVersion: string | null
  /** The customer's sshd port — the firewall rules must name the real one. */
  sshPort?: number
  /**
   * Pre-bake Chrome. At connect there is no instance and so no enabled-tool
   * list to consult, so this is the operator's blanket choice rather than a
   * per-agent one. Defaults to false: it is 142MB of the customer's bandwidth
   * for a tool that is opt-in, and `installToolDependencies()` installs it on
   * demand when somebody actually turns the browser tool on.
   */
  browserDeps?: boolean
  /** False on a server that already runs a web server (see prebakeDecision). */
  installCaddy?: boolean
}

/**
 * The full connect-time script: the universal bootstrap, then the universal
 * bake-finalize (Hermes' CLI warm-up). Runs as one SSH session and reports
 * through the same status file and log the real bootstrap uses.
 */
export function buildPrebakeScript(opts: PrebakeScriptOpts): string {
  return renderUniversalBootstrap({
    sshPort: opts.sshPort,
    // Never ours to turn on. The box belongs to the customer and may already
    // be serving unrelated traffic; the allow-rules still go in so an agent is
    // reachable when a firewall is already active.
    manageFirewall: false,
    browserDeps: opts.browserDeps === true,
    installCaddy: opts.installCaddy !== false,
    versions: opts.hermesVersion ? { hermes: opts.hermesVersion } : {},
    // Hermes' CLI warm-up, as after a pool bake. A subshell, so the finalize's
    // own `set -uo pipefail` (best-effort, no -e) does not leak into the
    // framing's `set -e`.
    extraSteps: `
step "prebake_finalize"
(
${buildBakeFinalizeScript(UNIVERSAL_POOL_RUNTIME).replace(/^#!.*\n/, "")}
)
`,
  })
}

/* --- Deploy-time verification ------------------------------------------- */

/**
 * One SSH round trip, run at the start of a BYOS deploy, that reports what is
 * ACTUALLY on the box.
 *
 * The rule this enforces: never trust `prebakeStatus`. That column is for the
 * UI ("ready to deploy in ~2 min"); it is not control flow. A customer can
 * `apt remove caddy`, rebuild the machine behind the same IP, or let a prebake
 * half-fail — and a deploy that branched on a stale flag would produce a
 * broken agent instead of a slow one.
 *
 * The deploy runs the full bootstrap either way. On a genuinely prebaked box
 * every step no-ops in seconds; on a drifted one the bootstrap self-heals.
 * This probe only decides what to TELL the customer and whether the pinned
 * versions still line up.
 */
export const PREBAKE_VERIFY_SCRIPT = `
node_v="$(node -v 2>/dev/null | sed 's/^v//')"; echo "node=\${node_v}"
echo "caddy=$(command -v caddy >/dev/null 2>&1 && echo 1 || echo 0)"
echo "uv=$(command -v uv >/dev/null 2>&1 && echo 1 || echo 0)"
hermes_v="$(/opt/hermes/venv/bin/hermes --version 2>/dev/null | tr -d '\\n' | grep -oE '[0-9]+(\\.[0-9]+)+' | head -1)"
echo "hermes=\${hermes_v}"
echo "lite=$([ -x ${LITE_BIN} ] && echo 1 || echo 0)"
echo "disk_avail_gb=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')"
`

export type PrebakeVerifyFacts = {
  nodeVersion: string | null
  hasCaddy: boolean
  hasUv: boolean
  hermesVersion: string | null
  /** AgentWebUI Lite, which every BYOS engine's deploy uses. */
  liteInstalled: boolean
  diskAvailGb: number | null
}

export function parsePrebakeVerify(stdout: string): PrebakeVerifyFacts {
  const kv = new Map<string, string>()
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=")
    if (eq === -1) continue
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const str = (k: string) => {
    const v = kv.get(k)
    return v && v !== "" ? v : null
  }
  const flag = (k: string) => {
    const n = Number.parseInt(kv.get(k) ?? "", 10)
    return Number.isFinite(n) && n > 0
  }
  const num = (k: string) => {
    const n = Number.parseInt(kv.get(k) ?? "", 10)
    return Number.isFinite(n) ? n : null
  }
  return {
    nodeVersion: str("node"),
    hasCaddy: flag("caddy"),
    hasUv: flag("uv"),
    hermesVersion: str("hermes"),
    liteInstalled: flag("lite"),
    diskAvailGb: num("disk_avail_gb"),
  }
}

export type PrebakeUsability = {
  /** True when the deploy can honestly promise the fast path. */
  fastPath: boolean
  /** Why not, for the log and the instance event. Empty when fastPath. */
  misses: string[]
}

/**
 * Whether the box is in the state the prebake was supposed to leave it in,
 * for the runtime about to be deployed.
 *
 * A miss is never fatal — the caller logs it and carries on into the full
 * bootstrap, which is what would have run anyway.
 */
export function prebakeUsability(opts: {
  runtime: string
  facts: PrebakeVerifyFacts
  /** The version persisted at connect, which the deploy intends to install. */
  hermesPin?: string | null
  minNodeVersion: string
}): PrebakeUsability {
  const misses: string[] = []
  const { facts } = opts

  const wantedMajor = opts.minNodeVersion.split(".")[0]
  if (!facts.nodeVersion) misses.push("node is not installed")
  else if (facts.nodeVersion.split(".")[0] !== wantedMajor) {
    misses.push(`node is v${facts.nodeVersion}, wanted major ${wantedMajor}`)
  }

  if (!facts.hasCaddy) misses.push("caddy is not installed")
  if (!facts.liteInstalled) misses.push("the chat UI is not installed")

  if (opts.runtime === "hermes") {
    if (!facts.hermesVersion) misses.push("hermes is not installed")
    else if (opts.hermesPin && facts.hermesVersion !== opts.hermesPin) {
      // Not a failure: the deploy installs the pin over whatever is there.
      // It does mean the install is a real one, so the fast-path promise is
      // no longer honest.
      misses.push(`hermes is ${facts.hermesVersion}, pinned to ${opts.hermesPin}`)
    }
  }

  return { fastPath: misses.length === 0, misses }
}

/* --- Shared install lock --------------------------------------------------- */

/** Lock file shared by the prebake and the BYOS deploy bootstrap on the box. */
const INSTALL_LOCK = "/var/lock/atlas-install.lock"

/**
 * Wrap an install script in an flock, so a prebake and a deploy never run apt
 * at the same time on one box. `waitSeconds` 0 gives up at once (the prebake:
 * if anything else is installing, it isn't needed); a deploy waits for a
 * running prebake to finish. Exit 75 (EX_TEMPFAIL) means the lock was busy.
 */
export function withInstallLock(script: string, waitSeconds: number): string {
  const lock = [
    `exec 9>${INSTALL_LOCK}`,
    waitSeconds > 0
      ? `flock -w ${waitSeconds} 9 || { echo "another install still holds ${INSTALL_LOCK}" >&2; exit 75; }`
      : `flock -n 9 || { echo "another install holds ${INSTALL_LOCK}" >&2; exit 75; }`,
  ].join("\n")
  const lines = script.split("\n")
  // Keep a shebang first.
  if (lines[0]?.startsWith("#!")) return [lines[0], lock, ...lines.slice(1)].join("\n")
  return `${lock}\n${script}`
}
