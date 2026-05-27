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
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildBootstrapFraming(
  opts: BootstrapFramingOpts,
  runtimeInstallSteps: string,
): string {
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

echo "running" > "$STATUS"
exec > >(tee -a "$LOG") 2>&1
echo "=== Bootstrap started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

step() { CURRENT_STEP="$1"; echo "=== STEP: $1 ===" ; }

# P1 transient: mirror flakiness
APT_OPTS="-o Acquire::Retries=3 -o Acquire::http::Timeout=120"

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
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

${runtimeInstallSteps}

step "caddy_cf_snippets"
${cfBlock}
step "firewall"
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
yes | ufw enable || true

echo "=== Bootstrap completed at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "done" > "$STATUS"
`
}
