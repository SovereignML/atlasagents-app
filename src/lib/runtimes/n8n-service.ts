import type { ToolService, ToolServiceEnvArgs } from "./types"

/**
 * n8n — a self-hosted workflow-automation server with its own web UI, run as a
 * per-tool companion service (see `ToolService`). Installed via `npm install -g
 * n8n` (every box already ships Node 22 for the runtimes), supervised by systemd
 * as a dedicated `n8n` system user, bound to loopback :5678, and mounted behind
 * Caddy at `/n8n/`. No Docker — same native-process model as the runtimes and the
 * Open WebUI sidecar. The agent controls it by driving the UI with the browser
 * tool, which the catalog auto-enables alongside n8n.
 */
export const N8N_SERVICE_NAME = "n8n"
export const N8N_PORT = 5678
export const N8N_SYSTEM_USER = "n8n"
/** URL subpath n8n is served under (Caddy routes `${N8N_PATH_PREFIX}/*` here). */
export const N8N_PATH_PREFIX = "/n8n"
const N8N_INSTALL_DIR = "/opt/n8n"
/** n8n's data dir (HOME/.n8n): SQLite DB, encryption key file, binary data. */
const N8N_DATA_DIR = "/opt/n8n/.n8n"
const N8N_BIN = "/usr/bin/n8n"
const N8N_ENV_PATH = "/opt/n8n/n8n.env"
export const N8N_VERSION = () => process.env.N8N_VERSION || "latest"

function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function n8nNpmSpec(): string {
  const v = N8N_VERSION()
  return v === "latest" ? "n8n" : `n8n@${v}`
}

export const n8nToolService: ToolService = {
  serviceName: N8N_SERVICE_NAME,
  systemUser: N8N_SYSTEM_USER,
  installDir: N8N_INSTALL_DIR,
  dataDir: N8N_DATA_DIR,
  port: N8N_PORT,
  caddyPathPrefix: N8N_PATH_PREFIX,
  // Served under N8N_PATH, so the health endpoint is prefixed too.
  healthPath: `${N8N_PATH_PREFIX}/healthz`,
  envPath: N8N_ENV_PATH,

  /**
   * Create the `n8n` system user + dirs and install the CLI globally with a 3×
   * retry (mirrors the runtime/sidecar installers). Idempotent: re-running
   * upgrades the package in place and leaves the existing data dir untouched.
   */
  installSteps(): string {
    return `
N8N_PKG_SPEC=${bashSingleQuote(n8nNpmSpec())}

echo "=== tool-service: n8n_user ==="
id ${bashSingleQuote(N8N_SYSTEM_USER)} >/dev/null 2>&1 || useradd --system --home-dir ${bashSingleQuote(N8N_INSTALL_DIR)} --shell /usr/sbin/nologin ${bashSingleQuote(N8N_SYSTEM_USER)}

echo "=== tool-service: n8n_dirs ==="
install -d -m 0750 -o ${bashSingleQuote(N8N_SYSTEM_USER)} -g ${bashSingleQuote(N8N_SYSTEM_USER)} ${bashSingleQuote(N8N_INSTALL_DIR)}
install -d -m 0750 -o ${bashSingleQuote(N8N_SYSTEM_USER)} -g ${bashSingleQuote(N8N_SYSTEM_USER)} ${bashSingleQuote(N8N_DATA_DIR)}

echo "=== tool-service: install_n8n_pkg ==="
install_n8n_pkg() {
  local max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== npm install n8n attempt $a/$max ==="
    if npm install -g --no-audit --no-fund "$N8N_PKG_SPEC"; then
      return 0
    fi
    if [ "$a" -eq $((max - 1)) ]; then
      npm cache clean --force 2>/dev/null || true
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}
install_n8n_pkg

echo "=== tool-service: verify_n8n_cli ==="
${bashSingleQuote(N8N_BIN)} --version >/dev/null
`
  },

  /**
   * n8n env. Binds loopback only (Caddy is the sole ingress) and is served under
   * N8N_PATH so it can share the instance's single public host with the gateway.
   * `N8N_EDITOR_BASE_URL`/`WEBHOOK_URL` must be the public `/n8n/` URL so the
   * editor's absolute links and webhook endpoints resolve behind the proxy.
   * `N8N_ENCRYPTION_KEY` is stable + persisted (see ToolServiceEnvArgs) so saved
   * credentials survive restarts. User management stays on so the seeded owner
   * account gates the UI — the public URL must never be an open editor.
   */
  renderEnv(args: ToolServiceEnvArgs): Record<string, string> {
    // pathPrefix arrives with a trailing slash (e.g. "/n8n/"); n8n's N8N_PATH
    // wants exactly that.
    const publicBase = args.publicUrl
      ? `${args.publicUrl.replace(/\/$/, "")}${args.pathPrefix}`
      : ""
    const env: Record<string, string> = {
      N8N_HOST: "127.0.0.1",
      N8N_PORT: String(N8N_PORT),
      N8N_PROTOCOL: "http",
      N8N_LISTEN_ADDRESS: "127.0.0.1",
      N8N_PATH: args.pathPrefix,
      N8N_ENCRYPTION_KEY: args.encryptionKey,
      N8N_USER_FOLDER: N8N_INSTALL_DIR,
      DB_TYPE: "sqlite",
      N8N_DIAGNOSTICS_ENABLED: "false",
      N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
      N8N_TEMPLATES_ENABLED: "false",
      N8N_HIRING_BANNER_ENABLED: "false",
      // n8n >=1.0 warns/refuses to start on some setups unless this is set; we
      // enforce our own permissions on the env file (chmod 600) anyway.
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
      GENERIC_TIMEZONE: "UTC",
    }
    if (publicBase) {
      env.N8N_EDITOR_BASE_URL = publicBase
      env.WEBHOOK_URL = publicBase
    }
    return env
  },

  renderSystemdUnit(): string {
    return `[Unit]
Description=n8n workflow automation (SovereignML tool)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=${N8N_SYSTEM_USER}
Group=${N8N_SYSTEM_USER}
WorkingDirectory=${N8N_INSTALL_DIR}
EnvironmentFile=${N8N_ENV_PATH}
Environment=HOME=${N8N_INSTALL_DIR}
ExecStart=${N8N_BIN} start
Restart=always
RestartSec=3
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
`
  },

  /**
   * n8n's first-run owner setup. `POST <prefix>/rest/owner/setup` with the owner
   * account; a subsequent call returns 400 ("instance owner already set up"),
   * which the seed script treats as already-seeded (idempotent on reprovision).
   */
  seedOwner: {
    setupPath: "/rest/owner/setup",
    buildPayload({ email, password }) {
      return {
        email,
        firstName: "Owner",
        lastName: "Admin",
        password,
      }
    },
  },
}
