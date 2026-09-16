/**
 * Shared cloud-init bootstrap framing for every runtime engine.
 *
 * The framing handles everything common across runtimes:
 *   - status file + log file + failure trap
 *   - apt update + base build deps
 *   - Caddy + Node.js repositories
 *   - Node 22 install + min-version verification
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

export type BootstrapFramingOpts = {
  /** Install / HOME dir for the runtime, e.g. /opt/openclaw or /opt/hermes. */
  installDir: string
  /** Dedicated system user created and owning installDir, e.g. "openclaw" or "hermes". */
  systemUser: string
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

export function buildBootstrapFraming(
  opts: BootstrapFramingOpts,
  runtimeInstallSteps: string,
): string {
  // Default 22 / manage-the-firewall preserves the managed-VPS behaviour these
  // options were factored out of; BYOS passes the real port and `false`.
  const sshPortLiteral = String(opts.sshPort ?? 22)
  const manageFirewall = opts.manageFirewall !== false
  const firewallEnableBlock = manageFirewall
    ? "  yes | ufw enable || true"
    : "  # Not enabling ufw: this server belongs to the customer. Turning a\n" +
      "  # firewall ON here could cut off whatever else they run on it. The\n" +
      "  # allow-rules above are still added so the agent is reachable when a\n" +
      "  # firewall is already active."

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
  if [ $ec -ne 0 ]; then
    echo "failed:\${CURRENT_STEP}" > "$STATUS"
    echo "=== BOOTSTRAP FAILED at step \${CURRENT_STEP} (exit $ec) ===" >> "$LOG"
  fi
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
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors https://deb.nodesource.com/setup_22.x | bash -

step "install_nodejs_caddy"
apt-get $APT_OPTS install -y nodejs caddy
node -v && npm -v

step "verify_node"
export RUNTIME_MIN_NODE=${shellEscape(opts.minNodeVersion)}
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
id ${shellEscape(opts.systemUser)} >/dev/null 2>&1 || useradd --system --home-dir ${shellEscape(opts.installDir)} --shell /usr/sbin/nologin ${shellEscape(opts.systemUser)}
mkdir -p ${shellEscape(opts.installDir)}
chown -R ${shellEscape(opts.systemUser)}:${shellEscape(opts.systemUser)} ${shellEscape(opts.installDir)}

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
