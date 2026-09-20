/**
 * BYOS connect-time prebake — the work that does not depend on which agent the
 * customer eventually deploys, moved off the deploy path.
 *
 * A BYOS box gets no warm pool and no golden image: today every deploy builds
 * from scratch inside the window the customer is sitting and watching. This
 * module does that work earlier, in the background, right after they connect
 * the server — so the later deploy is close to what a warm-pool claim already
 * is: write config, restart, health-check.
 *
 * The managed-VM equivalent is `buildBakeFinalizeScript` in warm-pool.ts, whose
 * own comment states the shape: *"the slow-once, per-instance-INDEPENDENT work,
 * run once the box has bootstrapped so the eventual claim is fast. Idempotent."*
 *
 * What gets installed vs merely downloaded is a deliberate, asymmetric choice:
 *
 *   - **Shared prerequisites** (apt, Caddy, Node, swap, accounts) — installed.
 *     Identical for both runtimes.
 *   - **The Hermes stack** (hermes-agent + Open WebUI) — installed, both
 *     systemd units written and enabled, and Open WebUI actually started once
 *     (see the `prebake_finalize` step) so its SQLite/alembic/bytecode
 *     first-run cost is paid here rather than mid-deploy. It is the heaviest item on the slow path and Open WebUI is not part
 *     of the customer's either/or: it is Hermes' sidecar and ships everywhere.
 *   - **OpenClaw** — downloaded into the npm cache only, never installed. It is
 *     the genuine either/or choice, and its 225MB / 11,428-file extract is what
 *     makes it expensive — the extract stays at deploy.
 *
 * Consequence, recorded honestly: a Hermes deploy ends up faster than an
 * OpenClaw one. That is a bet on which engine customers pick, taken while the
 * platform's own default is unresolved (the deploy wizard provisions OpenClaw;
 * the marketing site markets Hermes). See plans/007-byos-fast-deploy.md.
 *
 * NOTHING here runs without recorded consent — see `prebakeDecision`.
 */

import { buildPrereqScript } from "@/lib/runtimes/bootstrap"
import {
  HERMES_VPS_MIN_NODE,
  buildHermesPrebakeSteps,
} from "@/lib/runtimes/hermes"
import { OPENCLAW_VPS_MIN_NODE } from "@/lib/runtimes/openclaw"
import { buildBakeFinalizeScript } from "@/lib/runtimes/finalize"
import { npmSpec } from "@/lib/runtime-versions"
import type { PreflightFacts } from "@/lib/byos-preflight-parse"

/** Mirrors `byosServers.prebakeStatus`. */
export type PrebakeStatus = "none" | "running" | "ready" | "failed" | "skipped"

/**
 * Disk a prebaked box needs beyond the preflight's general floor: shared
 * prereqs + Chrome + an installed Open WebUI venv + the OpenClaw tarball in
 * the npm cache, on a machine that is also running whatever the customer
 * already runs.
 */
export const PREBAKE_DISK_REQUIRED_GB = 12

/**
 * The Node major every prebaked box gets. Both runtimes must accept it,
 * because at connect time the engine is not chosen yet — a box that gets one
 * runtime's major and is later handed the other's would be downgraded mid
 * deploy. They are equal by construction (see HERMES_VPS_MIN_NODE); this
 * picks the higher of the two so raising either one stays safe.
 */
export function prebakeMinNode(): string {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0)
  const [a, b] = [OPENCLAW_VPS_MIN_NODE, HERMES_VPS_MIN_NODE]
  const [pa, pb] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return a
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return b
  }
  return a
}

export type PrebakeDecision =
  | { run: true }
  | { run: false; status: Exclude<PrebakeStatus, "running" | "ready">; reason: string }

/**
 * Whether to prebake this server, and if not, why not.
 *
 * Pure so it can be unit-tested and so the connect UI can explain itself
 * before anything is touched.
 *
 * The conflict rules are the important part. The preflight deliberately does
 * NOT block on a busy :443, an active firewall, or an existing Caddyfile — it
 * surfaces them and tells the owner they are their call. Installing Caddy in
 * the background moments later would answer that call for them. So a conflict
 * defers the work to deploy time, where it is explicit and the customer has
 * just asked for it. The consent checkbox does not override this: it covers
 * "you may preinstall packages", not "you may reconfigure my web server".
 */
export function prebakeDecision(opts: {
  facts: Pick<
    PreflightFacts,
    "port443Busy" | "hasCaddy" | "hasNginx" | "hasApache" | "diskAvailGb"
  >
  consentAt: Date | null | undefined
}): PrebakeDecision {
  if (!opts.consentAt) {
    return {
      run: false,
      status: "none",
      reason: "The server owner has not agreed to have packages preinstalled.",
    }
  }

  const { facts } = opts
  if (facts.hasCaddy || facts.hasNginx || facts.hasApache || facts.port443Busy) {
    return {
      run: false,
      status: "skipped",
      reason:
        "This server already runs a web server or has :443 in use. We will " +
        "install everything at deploy time instead, so nothing changes on it " +
        "until you ask for an agent.",
    }
  }

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

  return { run: true }
}

/**
 * Warm the npm cache with OpenClaw's whole dependency tree, without installing
 * it and without unpacking anything.
 *
 * Three steps, none of which extract a file:
 *   1. `npm install --package-lock-only` resolves the full tree from registry
 *      metadata alone — no tarballs, no node_modules.
 *   2. The lockfile is read for every resolved `name@version`.
 *   3. `npm cache add` pulls each tarball into the shared npm cache and stops
 *      there.
 *
 * The obvious alternative — installing into a throwaway prefix — would warm
 * the same tarballs but pay OpenClaw's 11,428-file extract twice: once here
 * and again at deploy. This gets the same cache for one download and no
 * extract. The extract itself stays at deploy and is irreducible without
 * actually installing the package, which is the one thing the prebake is not
 * allowed to do for OpenClaw.
 *
 * Entirely best-effort. Every failure path leaves the cache as it was and the
 * deploy simply downloads, exactly as it does today.
 */
function buildOpenclawCacheStep(pin: string | null): string {
  const spec = shellEscape(npmSpec("openclaw", pin))
  return `
step "cache_openclaw"
# Download only — deliberately never installed here. See buildOpenclawCacheStep.
OC_WARM=/var/tmp/openclaw-warm
rm -rf "$OC_WARM" && mkdir -p "$OC_WARM"
if (
  cd "$OC_WARM" || exit 1
  npm init -y >/dev/null 2>&1 || exit 1
  # Resolve the tree from metadata alone: no tarballs, no node_modules.
  npm install --package-lock-only --no-audit --no-fund ${spec} >/dev/null 2>&1 || exit 1
  cat > warm.js <<'WARMJS'
const lock = require("./package-lock.json")
const out = new Set()
for (const [path, meta] of Object.entries(lock.packages || {})) {
  if (!path || !meta || !meta.version) continue
  const name = meta.name || path.split("node_modules/").pop()
  if (!name) continue
  out.add(name + "@" + meta.version)
}
process.stdout.write([...out].join("\\n") + "\\n")
WARMJS
  node warm.js > specs.txt 2>/dev/null || exit 1
  # Pull every tarball into the cache. Batched, because one npm invocation per
  # package would dominate the runtime; a failing batch is retried singly so a
  # single bad spec cannot cost us the whole tree.
  while read -r batch; do
    npm cache add $batch >/dev/null 2>&1 || for one in $batch; do npm cache add "$one" >/dev/null 2>&1 || true; done
  done < <(xargs -n 20 < specs.txt)
  echo "warmed $(wc -l < specs.txt) package specs into the npm cache"
); then
  :
else
  echo "openclaw cache warm failed — the deploy will download it instead"
fi
rm -rf "$OC_WARM"
`
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type PrebakeScriptOpts = {
  /** Resolved pins. Null means unpinned, which degrades to today's behaviour. */
  openclawVersion: string | null
  hermesVersion: string | null
  webuiVersion: string | null
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
}

/**
 * The full connect-time script. Runs as one SSH session, reports through the
 * same status file and log the real bootstrap uses.
 */
export function buildPrebakeScript(opts: PrebakeScriptOpts): string {
  const payload = [
    buildHermesPrebakeSteps({
      browserDeps: opts.browserDeps === true,
      pin: opts.hermesVersion ?? undefined,
      webuiPin: opts.webuiVersion ?? undefined,
    }),
    buildOpenclawCacheStep(opts.openclawVersion),
    // Install + enable the systemd units and pre-start Open WebUI, so the
    // deploy only rewrites config and restarts. This is the same script the
    // warm pool runs after a bake, for the same reason — and it is where the
    // sidecar's first-boot cost (SQLite schema, alembic migrations, importing
    // a very large Python tree) actually gets paid. Leaving it out was the
    // difference between "restart a warm service" and "cold-start Open WebUI
    // while the customer watches".
    //
    // Hermes only: OpenClaw is merely cached here, so writing its unit would
    // point systemd at a binary that does not exist yet. The deploy writes it.
    `
step "prebake_finalize"
${buildBakeFinalizeScript("hermes", true)}`,
  ].join("\n")

  return buildPrereqScript({
    accounts: [
      { installDir: "/opt/hermes", systemUser: "hermes" },
      { installDir: "/opt/openclaw", systemUser: "openclaw" },
    ],
    minNodeVersion: prebakeMinNode(),
    sshPort: opts.sshPort,
    // Never ours to turn on. The box belongs to the customer and may already
    // be serving unrelated traffic; the allow-rules still go in so an agent is
    // reachable when a firewall is already active.
    manageFirewall: false,
    payloadSteps: payload,
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
owui="$([ -x /opt/open-webui/venv/bin/open-webui ] && echo 1 || echo 0)"
echo "open_webui=\${owui}"
echo "openclaw_cached=$(npm cache ls openclaw 2>/dev/null | grep -c . || echo 0)"
echo "hermes_unit=$(systemctl list-unit-files hermes-gateway.service 2>/dev/null | grep -c hermes-gateway || echo 0)"
echo "disk_avail_gb=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')"
`

export type PrebakeVerifyFacts = {
  nodeVersion: string | null
  hasCaddy: boolean
  hasUv: boolean
  hermesVersion: string | null
  hasOpenWebui: boolean
  hermesUnitInstalled: boolean
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
    hasOpenWebui: flag("open_webui"),
    hermesUnitInstalled: flag("hermes_unit"),
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
  runtime: "openclaw" | "hermes"
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

  if (opts.runtime === "hermes") {
    if (!facts.hermesVersion) misses.push("hermes is not installed")
    else if (opts.hermesPin && facts.hermesVersion !== opts.hermesPin) {
      // Not a failure: the deploy installs the pin over whatever is there.
      // It does mean the install is a real one, so the fast-path promise is
      // no longer honest.
      misses.push(`hermes is ${facts.hermesVersion}, pinned to ${opts.hermesPin}`)
    }
    if (!facts.hasOpenWebui) misses.push("open-webui is not installed")
    // The prebake writes and enables both units so the deploy only has to
    // restart. A missing unit means the finalize step did not run (or was
    // undone), which is exactly the drift this probe exists to catch — it was
    // being collected and then ignored.
    if (!facts.hermesUnitInstalled) misses.push("the hermes-gateway unit is not installed")
  }

  return { fastPath: misses.length === 0, misses }
}
