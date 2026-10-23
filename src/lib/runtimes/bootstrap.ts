/**
 * Shared cloud-init bootstrap framing for every runtime engine.
 *
 * The framing handles everything common across runtimes:
 *   - status file + log file + failure trap
 *   - apt update + base build deps
 *   - Node.js (NodeSource, major derived from the runtime's own floor) + verification
 *   - Caddy (pinned release .deb, not an apt repository — see caddyInstallCommands)
 *   - dedicated system user + install dir + swap file
 *   - ufw firewall
 *
 * The Cloudflare origin certificate is NOT installed here any more: it goes on
 * over SSH when the agent is configured, for the zone its hostname is actually
 * in (src/lib/agent-origin-cert.ts).
 *
 * Each runtime injects its own install steps (npm install for OpenClaw, pip+venv
 * for Hermes) via `runtimeInstallSteps`. These run after swap is enabled (so
 * memory-heavy installs don't OOM) and before Caddy/firewall setup.
 */

/** Status file the bootstrap writes and `sshPollBootstrap` reads. Shared contract. */
export const BOOTSTRAP_STATUS = "/tmp/bootstrap.status"
/** Bootstrap stdout/stderr log. `sshPollBootstrap` tails this on failure. */
export const BOOTSTRAP_LOG = "/var/log/bootstrap.log"

export type SystemAccount = {
  /** Install / HOME dir, e.g. /opt/openclaw or /opt/hermes. */
  installDir: string
  /** Dedicated system user created and owning installDir. */
  systemUser: string
}

export type BootstrapFramingOpts = {
  /** Install / HOME dir for the runtime, e.g. /opt/openclaw or /opt/hermes. */
  installDir: string
  /** Dedicated system user created and owning installDir, e.g. "openclaw" or "hermes". */
  systemUser: string
  /**
   * Further accounts to create alongside the primary one. Empty for a normal
   * runtime bootstrap; the BYOS prebake passes every runtime's account,
   * because at connect time the customer has not picked an engine yet and a
   * `useradd` costs nothing.
   */
  extraAccounts?: SystemAccount[]
  /** Minimum Node version required; verify_node step fails if not satisfied. */
  minNodeVersion: string
  /** Gateway port the runtime listens on (loopback; Caddy fronts it). */
  gatewayPort: number
  /** Port sshd listens on; the firewall opens this rather than a hardcoded 22. */
  sshPort?: number
  /** False on BYOS — add allow-rules but never turn the firewall on. */
  manageFirewall?: boolean
  /**
   * False leaves Caddy out. The BYOS prebake uses it on a server that already
   * runs a web server: installing Caddy there is the deploy's call, not ours.
   */
  installCaddy?: boolean
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Which NodeSource distribution to install, derived from the runtime's own
 * `minNodeVersion`.
 *
 * This used to be hardcoded to `setup_22.x` while `minNodeVersion` was a
 * parameter, so the two could silently disagree — and they did. OpenClaw
 * declared a minimum of 22.14.0, the box got Node 22, `verify_node` passed, and
 * then `npm install --engine-strict openclaw@latest` refused with EBADENGINE
 * because the published package requires Node >=24.16. Every OpenClaw bootstrap
 * failed at `install_runtime`: warm-pool bakes looped create/fail/destroy, and
 * cold VPS and BYOS installs failed outright.
 *
 * Deriving it means a runtime states its Node requirement in exactly one place
 * and the box gets that Node. Raising a runtime's `minNode` is now sufficient.
 */
function nodeSourceMajor(minNodeVersion: string): number {
  const major = Number.parseInt(minNodeVersion.split(".")[0] ?? "", 10)
  if (!Number.isInteger(major) || major < 18 || major > 99) {
    throw new Error(
      `Cannot derive a NodeSource major from minNodeVersion "${minNodeVersion}" — ` +
        "expected a semver like \"24.16.0\".",
    )
  }
  return major
}

/**
 * Install a headless browser for the browser tool. Spliced into a runtime's
 * `runtimeInstallSteps`, so it runs inside the framing where `step` and
 * `APT_OPTS` are defined.
 *
 * We install **Google Chrome stable** (a real .deb) rather than Ubuntu 24.04's
 * `chromium-browser`, which is a *snap* shim: snap-confined Chromium refuses to
 * launch from inside a systemd service ("not a snap cgroup for tag
 * snap.chromium.chromium"), so the browser plugin can't drive it. Chrome ships
 * a genuine /usr/bin/google-chrome binary and is auto-detected first by the
 * runtimes. `fonts-liberation` covers common web fonts. Idempotent (apt no-ops
 * when present; the repo/key writes are overwrite-safe).
 */
/**
 * The apt options every apt call in a bootstrap should carry.
 *
 * `DPkg::Lock::Timeout` is the load-bearing one: a real server (as opposed to
 * a fresh cloud image) usually has unattended-upgrades running right after
 * boot, holding /var/lib/dpkg/lock-frontend for minutes. Without it, apt fails
 * instantly with "could not get lock" instead of waiting its turn.
 *
 * Exported because callers OUTSIDE the bootstrap framing — which have no
 * `$APT_OPTS` shell variable to reference — need the same flags. They used not
 * to have them: `buildToolDepsScript` in provisioner.ts carried only
 * `Acquire::Retries`, so enabling the browser tool on an already-running box
 * (almost always a BYOS box, i.e. exactly the "real server" case above) could
 * fail instantly on the dpkg lock.
 */
export const APT_OPTS_LITERAL =
  "-o Acquire::Retries=3 -o Acquire::http::Timeout=120 -o DPkg::Lock::Timeout=120"

/**
 * Apt sources that are known to be dead and must not be left in place.
 *
 * Caddy's Cloudsmith repository (dl.cloudsmith.io/public/caddy/stable) has
 * answered every index request with `402 Payment Required` since 2026-10-09
 * 05:58 UTC — the project ran through its bandwidth quota
 * (caddyserver/dist#142). One failing source makes `apt-get update` exit
 * non-zero, so while that file exists nothing on the box can apt-get anything:
 * not this bootstrap, not the browser tool's Chrome install, not the customer.
 *
 * Every box we bootstrapped before that date carries the file — managed VPSes
 * and BYOS servers alike — so this runs before the first `apt-get update` of
 * the bootstrap and of every later apt script we send. It renames rather than
 * deletes, because on a BYOS server the file may predate us, and apt ignores
 * any name that does not end in .list or .sources.
 */
export const DISABLE_DEAD_APT_SOURCES = `for f in /etc/apt/sources.list.d/caddy-stable.list /etc/apt/sources.list.d/caddy-stable.sources; do
  if [ -f "$f" ]; then
    mv -f "$f" "$f.disabled-by-atlas"
    echo "disabled $f — Caddy's Cloudsmith apt repo answers 402 (caddyserver/dist#142)"
  fi
done`

/**
 * The Caddy release every box gets. Override with CADDY_VERSION.
 *
 * Pinned rather than "whatever the repository serves", for the same reason the
 * runtimes are: an upstream release should reach the fleet when we choose, not
 * the moment it is published. 2.11.4 rather than one-behind-latest 2.11.6
 * because 2.11.6 shipped a crash when proxying over HTTP/2 and cut SSE streams
 * off after 60s — both fixed in 2.11.7 — and every agent streams its chat
 * through Caddy. 2.11.4 is also what the bulk of the running fleet already
 * got from the old repository between June and October.
 */
export const CADDY_DEFAULT_VERSION = "2.11.4"

/**
 * SHA-512 of the official release .debs for CADDY_DEFAULT_VERSION, copied from
 * that release's caddy_<v>_checksums.txt. Pinning the hash here, not just the
 * version, means a swapped release asset fails verification instead of being
 * installed as root on every box. An overridden version has no entry and is
 * checked against its release's published checksums file instead.
 */
const CADDY_DEB_SHA512: Record<string, Record<string, string>> = {
  "2.11.4": {
    amd64:
      "1c6f5404f3622e46d401d81f4af59677d46b886229c6694d60fd936b87c72d3bb5d1fcf42b55c8d555769fa75acf434ab618fc7e0df2c79cf8512ee580d38d06",
    arm64:
      "c43c62b7b583b31c682b3c3e1a31cf03759fbab01dcb0fc7d7fc3a5ce1bef43403583e26133920634a730a9fe31dae1386af4d3f9f3fc19fcc2c29ebf19de235",
  },
}

/** Same character set the runtime pins allow (runtime-versions.ts), since this lands in a shell word. */
const CADDY_VERSION_RE = /^[0-9]+(\.[0-9]+){1,3}$/

export function caddyVersion(): string {
  const v = process.env.CADDY_VERSION?.trim()
  if (!v) return CADDY_DEFAULT_VERSION
  if (!CADDY_VERSION_RE.test(v)) {
    throw new Error(`CADDY_VERSION "${v}" is not a plain release number like "${CADDY_DEFAULT_VERSION}".`)
  }
  return v
}

/**
 * Install Caddy from its own GitHub release instead of an apt repository.
 *
 * The bootstrap used to add Caddy's Cloudsmith repo and `apt-get install
 * caddy`. When that repo started answering 402, the NodeSource setup script's
 * own `apt-get update` failed, it printed an error but exited 0, the NodeSource
 * repo was never added, and apt quietly installed Ubuntu's nodejs 18 (no npm)
 * and Ubuntu's caddy 2.6.2 instead. The bootstrap then died on `npm -v` with
 * exit 127 — every OpenClaw and Hermes deploy, cold, warm-pool and BYOS.
 *
 * The release .deb is the same package the repo served (same unit, same
 * `caddy` user from its postinst). It is verified against a pinned SHA-512
 * before install. Only if GitHub cannot be reached does it fall back to the
 * distro's own caddy (2.6.2 on Ubuntu 24.04 / Debian 12), which every
 * Caddyfile we render has been validated against; a slightly older proxy
 * beats a failed deploy.
 *
 * Never downgrades: a box that already runs this version or newer (e.g. a
 * BYOS server that got 2.11.7 from the old repo) keeps it. confold keeps an
 * existing /etc/caddy/Caddyfile — by then it is ours, and the deploy rewrites
 * it anyway — rather than stopping on a conffile prompt nobody can answer.
 */
export function caddyInstallCommands(aptOpts: string, version: string = caddyVersion()): string {
  const hashes = CADDY_DEB_SHA512[version] ?? {}
  return `CADDY_VERSION='${version}'
CADDY_ARCH="$(dpkg --print-architecture)"
CUR_CADDY="$(dpkg-query -W -f='\${Version}' caddy 2>/dev/null || true)"
if [ -n "\${CUR_CADDY}" ] && command -v caddy >/dev/null 2>&1 && dpkg --compare-versions "\${CUR_CADDY}" ge "\${CADDY_VERSION}"; then
  echo "caddy \${CUR_CADDY} already installed (>= \${CADDY_VERSION}) — keeping it"
else
  case "\${CADDY_ARCH}" in
    amd64) CADDY_SHA512='${hashes.amd64 ?? ""}' ;;
    arm64) CADDY_SHA512='${hashes.arm64 ?? ""}' ;;
    *) CADDY_SHA512='' ;;
  esac
  CADDY_REL="https://github.com/caddyserver/caddy/releases/download/v\${CADDY_VERSION}"
  CADDY_DEB_NAME="caddy_\${CADDY_VERSION}_linux_\${CADDY_ARCH}.deb"
  CADDY_DEB="/tmp/\${CADDY_DEB_NAME}"
  if [ -z "\${CADDY_SHA512}" ]; then
    CADDY_SHA512="$(curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "\${CADDY_REL}/caddy_\${CADDY_VERSION}_checksums.txt" 2>/dev/null | awk -v f="\${CADDY_DEB_NAME}" '$2 == f { print $1 }' || true)"
  fi
  if [ -n "\${CADDY_SHA512}" ] \\
    && curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors -o "\${CADDY_DEB}" "\${CADDY_REL}/\${CADDY_DEB_NAME}" \\
    && echo "\${CADDY_SHA512}  \${CADDY_DEB}" | sha512sum -c --status -; then
    apt-get ${aptOpts} -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install -y "\${CADDY_DEB}"
  else
    echo "WARNING: could not download and verify caddy \${CADDY_VERSION} from GitHub — falling back to the distro package" >&2
    apt-get ${aptOpts} -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install -y caddy
  fi
  rm -f "\${CADDY_DEB}"
fi
caddy version`
}

/**
 * The Google Chrome install, as bare commands.
 *
 * `aptOpts` is the shell text used for apt flags: inside the bootstrap framing
 * that is the `$APT_OPTS` variable; outside it, the literal above. This exists
 * so the commands themselves live in ONE place — provisioner.ts used to carry
 * a hand-copied "self-contained mirror" of them, and the two had already
 * drifted apart on exactly the flags that matter.
 */
export function chromeInstallCommands(aptOpts: string): string {
  return `install -d -m 0755 /usr/share/keyrings
curl -fsSL --retry 5 --retry-delay 3 https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get ${aptOpts} update -y
apt-get ${aptOpts} install -y google-chrome-stable fonts-liberation`
}

export function browserInstallStep(): string {
  return `
step "install_chrome"
${chromeInstallCommands("$APT_OPTS")}
`
}

/**
 * The runtime-agnostic half of the bootstrap: everything that does NOT depend
 * on which agent the customer eventually deploys.
 *
 * Used by the BYOS connect-time prebake. It is the same framing the real
 * bootstrap uses — same status file, same log, same failure trap, same
 * idempotent steps — with every runtime's system account created up front and
 * a payload of install steps that are worth doing before the choice is made.
 *
 * No Cloudflare origin cert here (nor in any bootstrap): the deploy installs
 * the one matching the agent's hostname over SSH.
 *
 * This script is safe to run again. The deploy re-runs the full bootstrap
 * regardless (see plan 007 W8) and relies on every step here no-opping.
 */
export function buildPrereqScript(opts: {
  /** Every runtime's account. The first is the framing's primary. */
  accounts: [SystemAccount, ...SystemAccount[]]
  /** The highest floor across the runtimes, so one Node serves all of them. */
  minNodeVersion: string
  sshPort?: number
  manageFirewall?: boolean
  installCaddy?: boolean
  /** Install steps to run inside the framing, after swap. */
  payloadSteps?: string
}): string {
  const [primary, ...rest] = opts.accounts
  return buildBootstrapFraming(
    {
      installDir: primary.installDir,
      systemUser: primary.systemUser,
      extraAccounts: rest,
      minNodeVersion: opts.minNodeVersion,
      // No runtime is chosen yet, so there is no gateway to point at.
      gatewayPort: 0,
      sshPort: opts.sshPort,
      manageFirewall: opts.manageFirewall,
      installCaddy: opts.installCaddy,
    },
    opts.payloadSteps ?? "",
  )
}

export function buildBootstrapFraming(
  opts: BootstrapFramingOpts,
  runtimeInstallSteps: string,
): string {
  // Default 22 / manage-the-firewall preserves the managed-VPS behaviour these
  // options were factored out of; BYOS passes the real port and `false`.
  const sshPortLiteral = String(opts.sshPort ?? 22)
  // Install the Node major the runtime actually requires (see nodeSourceMajor).
  const nodeMajor = nodeSourceMajor(opts.minNodeVersion)
  const manageFirewall = opts.manageFirewall !== false
  const firewallEnableBlock = manageFirewall
    ? "  yes | ufw enable || true"
    : "  # Not enabling ufw: this server belongs to the customer. Turning a\n" +
      "  # firewall ON here could cut off whatever else they run on it. The\n" +
      "  # allow-rules above are still added so the agent is reachable when a\n" +
      "  # firewall is already active."

  // One block per account. With a single account this is byte-for-byte what
  // the step emitted when it only knew about one.
  const accountBlocks = [
    { installDir: opts.installDir, systemUser: opts.systemUser },
    ...(opts.extraAccounts ?? []),
  ]
    .map(
      (a) =>
        `id ${shellEscape(a.systemUser)} >/dev/null 2>&1 || useradd --system --home-dir ${shellEscape(a.installDir)} --shell /usr/sbin/nologin ${shellEscape(a.systemUser)}
mkdir -p ${shellEscape(a.installDir)}
chown -R ${shellEscape(a.systemUser)}:${shellEscape(a.systemUser)} ${shellEscape(a.installDir)}`,
    )
    .join("\n")

  return `#!/bin/bash
set -euo pipefail

LOG="${BOOTSTRAP_LOG}"
STATUS="${BOOTSTRAP_STATUS}"
CURRENT_STEP="init"

cleanup() {
  local ec=$?
  # Status first, always. Everything below is best-effort; the one thing that
  # must survive is the name of the step that failed.
  if [ $ec -ne 0 ]; then
    echo "failed:\${CURRENT_STEP}" > "$STATUS"
    echo "=== BOOTSTRAP FAILED at step \${CURRENT_STEP} (exit $ec) ===" >> "$LOG"
  fi
  # Close the tee pipe and let it drain before we exit. Bash does not wait for a
  # process substitution to finish, so on an abrupt \`set -e\` abort the final
  # writes can in principle be lost. Cheap insurance rather than a fix for an
  # observed truncation: every reader of this log reads its TAIL, so the end of
  # it is the one part that must not go missing.
  exec 1>&- 2>&- || true
  sleep 1 || true
}
trap cleanup EXIT

# Clear stale status/log from a prior run before the first write. BYOS servers
# are reused across deploys, so a status/log file left behind by an earlier
# (possibly root-owned) attempt would make the first "running" write fail with
# a permission error and abort under set -e. Running as root (managed cloud-init
# or a resolved-elevation BYOS bootstrap) makes this a reliable reset; no-op on
# a first-ever boot.
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
rm -f "$STATUS" "$LOG" 2>/dev/null || true

echo "running" > "$STATUS"
exec > >(tee -a "$LOG") 2>&1
echo "=== Bootstrap started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

step() { CURRENT_STEP="$1"; echo "=== STEP: $1 ===" ; }

# P1 transient: mirror flakiness.
# DPkg::Lock::Timeout: a real server (rather than a fresh cloud image) usually
# has unattended-upgrades running right after boot, holding
# /var/lib/dpkg/lock-frontend for minutes. Without this every apt call fails
# instantly with "could not get lock" instead of waiting its turn.
APT_OPTS="${APT_OPTS_LITERAL}"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

step "apt_sources"
${DISABLE_DEAD_APT_SOURCES}

step "apt_update"
apt-get $APT_OPTS update -y

step "build_deps"
apt-get $APT_OPTS install -y ca-certificates curl gnupg ufw git

step "nodejs_repo"
export RUNTIME_MIN_NODE=${shellEscape(opts.minNodeVersion)}
NODE_MAJOR_WANTED=${nodeMajor}
# Skip the repo add and the nodejs install when the box already runs exactly
# the Node this runtime asked for. Two reasons:
#
#   - Re-runs. A BYOS box re-runs this whole script on every deploy, and once
#     it is prebaked at connect that is at least twice. Re-adding the
#     NodeSource repo and reinstalling nodejs each time is pure latency.
#   - Downgrades. A prebake installs one Node major before the customer has
#     picked a runtime. Without this guard, a later bootstrap for a runtime
#     naming a LOWER major would add setup_<lower>.x and let apt drag the box
#     backwards underneath an already-installed runtime.
#
# The major must match EXACTLY rather than merely clearing the floor: a
# runtime's engines range can exclude a higher major (openclaw accepts 24.x
# and 26.x but not 25.x), so "anything newer is fine" is not true here.
node_is_wanted() {
  command -v node >/dev/null 2>&1 || return 1
  local cur
  cur="$(node -v 2>/dev/null | sed 's/^v//')" || return 1
  [ -n "\${cur}" ] || return 1
  [ "\${cur%%.*}" = "\${NODE_MAJOR_WANTED}" ] || return 1
  # Floor check inside the major. sort -V is coreutils, present on every
  # distro the preflight admits (ubuntu/debian).
  [ "$(printf '%s\\n%s\\n' "\${RUNTIME_MIN_NODE}" "\${cur}" | sort -V | head -1)" = "\${RUNTIME_MIN_NODE}" ]
}

if node_is_wanted; then
  echo "node $(node -v) already satisfies \${RUNTIME_MIN_NODE} (major \${NODE_MAJOR_WANTED}) — skipping NodeSource"
  step "install_nodejs"
else
  curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors https://deb.nodesource.com/setup_${nodeMajor}.x | bash -
  # The NodeSource script reports some failures — a failing \`apt-get update\`
  # among them — and still exits 0. Unchecked, apt then installs the distro's
  # nodejs (18, with no npm, on Ubuntu 24.04) and the bootstrap dies much later
  # on "npm: command not found". Refuse here, where the cause is still on screen.
  if ! grep -rqs "deb.nodesource.com" /etc/apt/sources.list.d/; then
    echo "NodeSource did not register its apt repository (see its output above) — refusing to install the distro nodejs" >&2
    exit 1
  fi
  step "install_nodejs"
  apt-get $APT_OPTS install -y nodejs
fi
# Whatever path got us here, the box must now run the major we asked for, with
# npm. A distro nodejs that slipped through would fail this, not \`npm install\`.
NODE_MAJOR_HAVE="$(node -v 2>/dev/null | sed 's/^v//; s/\\..*//')"
if [ "\${NODE_MAJOR_HAVE}" != "\${NODE_MAJOR_WANTED}" ] || ! command -v npm >/dev/null 2>&1; then
  echo "expected Node \${NODE_MAJOR_WANTED}.x with npm; found node $(node -v 2>/dev/null || echo none), npm $(command -v npm || echo missing)" >&2
  exit 1
fi
node -v && npm -v

${
  opts.installCaddy === false
    ? `# install_caddy skipped: this server already runs a web server; the deploy installs Caddy.`
    : `step "install_caddy"
${caddyInstallCommands("$APT_OPTS")}`
}

step "verify_node"
node <<'VERIFYNODE'
const min = process.env.RUNTIME_MIN_NODE
if (!min) {
  console.error("RUNTIME_MIN_NODE not set")
  process.exit(1)
}
const cur = process.version.slice(1)
const parts = (s) => s.split(".").map((x) => parseInt(x, 10) || 0)
const a = parts(cur)
const b = parts(min)
const n = Math.max(a.length, b.length)
for (let i = 0; i < n; i++) {
  const ai = a[i] ?? 0
  const bi = b[i] ?? 0
  if (ai > bi) process.exit(0)
  if (ai < bi) {
    console.error("Node.js " + min + "+ is required (current: v" + cur + ").")
    process.exit(1)
  }
}
process.exit(0)
VERIFYNODE

step "create_user"
${accountBlocks}

step "swap"
# Skip when the box already has swap of any kind (partition, zram, another
# swapfile) — it only checked for /swapfile before, so a customer server with a
# swap partition got a second, redundant 2G file, which on a small disk hurts.
# swapon is best-effort: it fails on container hosts (LXC/OpenVZ) where swap
# isn't ours to configure, and under \`set -e\` that aborted the whole bootstrap.
EXISTING_SWAP="$(awk 'NR>1 {print $1}' /proc/swaps 2>/dev/null | head -1 || true)"
if [ -z "\${EXISTING_SWAP}" ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  if mkswap /swapfile >/dev/null 2>&1 && swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    echo "swap unavailable on this host (container?) — continuing without it"
    rm -f /swapfile
  fi
else
  echo "swap already present (\${EXISTING_SWAP:-/swapfile}) — leaving it alone"
fi

${runtimeInstallSteps}

step "firewall"
# Open the port sshd is ACTUALLY on. This was hardcoded to 22, which on a BYOS
# server listening elsewhere meant enabling a firewall that blocked SSH — we
# lost the box mid-provision and so did its owner.
if command -v ufw >/dev/null 2>&1; then
  ufw allow ${sshPortLiteral}/tcp || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
${firewallEnableBlock}
fi

echo "=== Bootstrap completed at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "done" > "$STATUS"
`
}
