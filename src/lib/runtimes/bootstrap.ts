/**
 * Shared cloud-init bootstrap framing for every runtime engine.
 *
 * The framing handles everything common across runtimes:
 *   - status file + log file + failure trap
 *   - apt update + base build deps
 *   - Caddy + Node.js repositories
 *   - Node install (major derived from the runtime's own floor) + verification
 *   - dedicated system user + install dir + swap file
 *   - optional Cloudflare wildcard origin-cert snippet
 *   - ufw firewall
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
  /** Gateway port — baked into the Cloudflare wildcard Caddy snippet. */
  gatewayPort: number
  cfOriginCertPem?: string
  cfOriginKeyPem?: string
  /** Port sshd listens on; the firewall opens this rather than a hardcoded 22. */
  sshPort?: number
  /** False on BYOS — add allow-rules but never turn the firewall on. */
  manageFirewall?: boolean
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
export function browserInstallStep(): string {
  return `
step "install_chrome"
install -d -m 0755 /usr/share/keyrings
curl -fsSL --retry 5 --retry-delay 3 https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get $APT_OPTS update -y
apt-get $APT_OPTS install -y google-chrome-stable fonts-liberation
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
 * Deliberately no Cloudflare origin-cert snippet: that snippet bakes in a
 * single `gatewayPort`, and at connect time we do not know which runtime's
 * port applies. The deploy writes it, which is one small file write.
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
      // Unused without cf cert PEMs, which a prebake never passes.
      gatewayPort: 0,
      sshPort: opts.sshPort,
      manageFirewall: opts.manageFirewall,
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

  let cfBlock = ""
  if (opts.cfOriginCertPem && opts.cfOriginKeyPem) {
    const certB64 = Buffer.from(opts.cfOriginCertPem, "utf8").toString("base64")
    const keyB64 = Buffer.from(opts.cfOriginKeyPem, "utf8").toString("base64")
    cfBlock = `
step "cf_origin_cert"
install -d -m 0750 -o caddy -g caddy /etc/caddy/cf
echo '${certB64}' | base64 -d > /etc/caddy/cf/origin.pem
echo '${keyB64}' | base64 -d > /etc/caddy/cf/origin.key
chown caddy:caddy /etc/caddy/cf/origin.pem /etc/caddy/cf/origin.key
chmod 0640 /etc/caddy/cf/origin.pem
chmod 0600 /etc/caddy/cf/origin.key

install -d -m 0755 /etc/caddy/snippets
cat > /etc/caddy/snippets/sovereignclaw.caddy <<'CFSNIP'
*.sovereignclaw.xyz {
  tls /etc/caddy/cf/origin.pem /etc/caddy/cf/origin.key
  reverse_proxy 127.0.0.1:${opts.gatewayPort}
}
CFSNIP
`
  }

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
APT_OPTS="-o Acquire::Retries=3 -o Acquire::http::Timeout=120 -o DPkg::Lock::Timeout=120"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

step "apt_update"
apt-get $APT_OPTS update -y

step "build_deps"
apt-get $APT_OPTS install -y ca-certificates curl gnupg ufw git debian-keyring debian-archive-keyring apt-transport-https

step "caddy_repo"
curl --retry 5 --retry-delay 3 -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl --retry 5 --retry-delay 3 -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null

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
  # The NodeSource setup script runs its own \`apt-get update\`, and that is
  # what makes the caddy repo added in the previous step visible to apt. When
  # we skip the script we must do that update ourselves, or installing caddy
  # on a box that does not already have it fails with "Unable to locate
  # package caddy".
  apt-get $APT_OPTS update -y
  step "install_nodejs_caddy"
  apt-get $APT_OPTS install -y caddy
else
  curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors https://deb.nodesource.com/setup_${nodeMajor}.x | bash -
  step "install_nodejs_caddy"
  apt-get $APT_OPTS install -y nodejs caddy
fi
node -v && npm -v

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

step "caddy_cf_snippets"
${cfBlock}
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
