import type { InferSelectModel } from "drizzle-orm"
import type { instances } from "@/db"
import type { LlmProvider } from "@/lib/model-router"

type Instance = InferSelectModel<typeof instances>

/** Selectable agent runtime engines for the VPS (dedicated-VM) path. */
export type RuntimeId = "openclaw" | "hermes"

/** Inputs to the gateway config renderer (runtime-agnostic; format may be JSON or YAML). */
export type RenderConfigArgs = {
  gatewayToken: string
  openRouterApiKey: string
  model: string
  fallbackModel: string
  domain?: string | null
  managedSubdomain?: string | null
  ipAddress?: string | null
  tlsStatus?: string | null
  /** Catalog tool ids enabled on the instance (e.g. ["browser"]); see agent-tools.ts. */
  enabledToolIds?: string[]
  /**
   * OpenAI-compatible base URL the primary/fallback models are served from
   * (e.g. OpenRouter's `https://openrouter.ai/api/v1`, or a BYO provider's
   * endpoint). OpenClaw ignores this (its package is hardwired to OpenRouter);
   * Hermes/base-URL-aware renderers honor it. See resolveByosLlmCredentials().
   */
  baseUrl?: string
}

/**
 * Inputs to `renderInitScript` — the optional post-`.env`, pre-start bash a runtime runs
 * over SSH to initialize itself with its own CLI (Hermes uses this). All values are already
 * resolved/validated by the provisioner; the script just consumes them.
 */
export type RenderInitScriptArgs = {
  /** Install / HOME dir, e.g. /opt/hermes. */
  installDir: string
  /** Dedicated system user the CLI must run as (HOME=installDir). */
  systemUser: string
  /** Absolute path to the runtime CLI, e.g. /opt/hermes/venv/bin/hermes. */
  cliBinary: string
  /** Absolute path of the `.env` already written in Phase A (the CLI reads it). */
  envPath: string
  /**
   * Provider token to register with Hermes (`config set model.provider`).
   * "openrouter" by default; "nvidia" for the NVIDIA platform fallback; a BYO
   * OpenAI-compatible token (e.g. "openai") for a customer's own direct key.
   * A non-"openrouter" value also triggers the `model.base_url` set.
   */
  provider: LlmProvider | string
  /** Validated model slug (<author>/<slug>, ≥64k context) to pin as the default. */
  model: string
  /** OpenAI-compatible base URL for the provider (e.g. NVIDIA's endpoint). */
  baseUrl: string
  /** Catalog tool ids enabled on the instance (e.g. ["browser"]); see agent-tools.ts. */
  enabledToolIds?: string[]
  /**
   * Warm-pool fast path: skip the slow-once, per-instance-independent steps
   * (`setup --quick`, `doctor --fix`) that already ran at bake. Only the
   * per-instance config deltas + a fast `config check` run at claim. Ignored by
   * runtimes without an init script.
   */
  skipSetupAndDoctor?: boolean
}

/** Inputs to the `.env` builder. */
export type BuildEnvArgs = {
  instance: Instance
  /** OpenClaw-only: admin email for the gateway login. Hermes ignores. */
  adminEmail: string
  /** OpenClaw-only: admin password for the gateway login. Hermes ignores. */
  adminPassword: string
  /** Bearer token for the gateway API. Hermes maps this to API_SERVER_KEY. */
  gatewayToken: string
  openRouterApiKey: string
  /**
   * OpenAI-compatible base URL the LLM key authenticates against. Optional /
   * back-compat: undefined ⇒ the runtime's default (OpenRouter). OpenClaw
   * ignores it; Hermes uses it (via renderInitScript) for BYO providers.
   */
  baseUrl?: string
}

export type RenderCaddyfileArgs = {
  domain?: string | null
  managedSubdomain?: string | null
  /** When true, emit TLS for managed host using certs at /etc/caddy/cf/ (bootstrap). */
  useCfOriginTls?: boolean
  /**
   * When true, the custom `domain` is fronted by the user's own Cloudflare
   * proxy (orange-cloud, Bring-Your-Own-Cloudflare). Caddy serves a self-signed
   * cert (`tls internal`) on 443 — accepted by Cloudflare in "Full" (not strict)
   * SSL mode. Without this flag a custom domain uses automatic Let's Encrypt.
   */
  domainUseInternalTls?: boolean
  /**
   * When set, Caddy reverse-proxies the public host to this loopback port
   * instead of the runtime's `gatewayPort`. Used to put a sidecar (Open WebUI
   * on :8080) in front of the gateway, which stays loopback-only.
   */
  upstreamPort?: number
  /**
   * Per-tool companion services (e.g. n8n) to path-route on the SAME public
   * host: each `pathPrefix/*` is proxied to the loopback `port` with a Caddy
   * `handle` block placed AHEAD of the gateway/sidecar catch-all. An
   * empty/undefined list renders byte-identically to the pre-tool-service
   * output, so existing instances see no Caddyfile diff. See `ToolService`.
   */
  toolServices?: ToolServiceRoute[]
}

/** Minimal Caddy routing info for a per-tool companion service. */
export type ToolServiceRoute = {
  /** URL path prefix, no trailing slash, e.g. "/n8n". Routed as `<prefix>/*`. */
  pathPrefix: string
  /** Loopback port the service binds; Caddy proxies `<prefix>/*` here. */
  port: number
}

/** Absolute remote paths the provisioner needs, all derived from installDir. */
export type RuntimeWorkspacePaths = {
  /** Home / WorkingDirectory, e.g. /opt/openclaw */
  installDir: string
  /** Config subdir name under installDir, e.g. ".openclaw" (Hermes: ".hermes") */
  configSubdir: string
  /** Config file name, e.g. "openclaw.json" (Hermes: "config.yaml") */
  configFileName: string
  /** Full config path = installDir/configSubdir/configFileName */
  configPath: string
  /** Workspace dir = installDir/configSubdir/workspace */
  workspaceDir: string
  /** .env path — OpenClaw: installDir/.env; Hermes: installDir/configSubdir/.env */
  envPath: string
  /** system user + group created in bootstrap (== runtime id) */
  systemUser: string
}

/**
 * Inputs to `renderBootstrap`. Each runtime owns its own install bash and
 * passes these along to the shared `buildBootstrapFraming` helper.
 */
export type BootstrapRenderArgs = {
  gatewayPort: number
  cfOriginCertPem?: string
  cfOriginKeyPem?: string
  /** When true, the runtime appends its sidecar install steps (pip + venv). */
  webuiEnabled?: boolean
  /**
   * Whether to pre-bake the browser-tool system dependencies (Google Chrome,
   * ~142MB, plus `agent-browser` on Hermes).
   *
   * Defaults to TRUE when omitted, which preserves the long-standing
   * behaviour: every box got Chrome whether or not anything used it. That is
   * right for a warm-pool bake (our VM, our time, and the claim must be fast)
   * and wrong for BYOS, where it is the customer's bandwidth and it lands in
   * the middle of the window they are watching.
   *
   * Tools are opt-in — `agent-tools.ts` has no `defaultEnabled` — so pass
   * false whenever no enabled tool sets `requiresChromium`. Enabling the tool
   * later still works: `installToolDependencies()` installs the same set on
   * demand.
   */
  browserDeps?: boolean
  /**
   * The port sshd actually listens on. Defaults to 22. BYOS servers may use
   * anything — and the firewall step opens THIS port, not a hardcoded 22.
   * Getting it wrong locks us (and the customer) out of their own machine.
   */
  sshPort?: number
  /**
   * Whether this host's firewall is ours to turn on. True for VMs we provision;
   * **false for BYOS**, where the box is the customer's and may already be
   * serving unrelated traffic. When false we still add our allow-rules (so the
   * agent is reachable if a firewall is already active) but never run
   * `ufw enable`. Defaults to true, preserving managed-VPS behaviour.
   */
  manageFirewall?: boolean
}

/** Inputs to a sidecar's `.env` builder (e.g. Open WebUI fronting Hermes). */
export type SidecarEnvArgs = {
  instance: Instance
  /** Bearer token the gateway expects — becomes the sidecar's OPENAI_API_KEY. */
  gatewayToken: string
  /** Loopback port the runtime gateway binds — becomes OPENAI_API_BASE_URL host:port. */
  gatewayPort: number
  /** Random secret persisted in the sidecar env (session signing). */
  secretKey: string
  /** Public URL the sidecar is reached at (absolute links / cookies behind the proxy). */
  publicUrl?: string | null
  /** Open signup window — true on first boot, flipped to false after the admin is seeded. */
  enableSignup: boolean
  /**
   * The model slug the gateway is pinned to (same value the runtime writes as its
   * own default). A chat UI sidecar needs this to pre-select a model for a fresh
   * account — without it the first message has no model attached. Should match an
   * `id` the gateway returns from `GET /v1/models`.
   */
  model: string
}

/**
 * An optional process sidecar a runtime can run alongside its gateway — Hermes
 * uses this to put Open WebUI in front of its OpenAI-compatible API. The
 * gateway stays loopback-only; the sidecar (also loopback) is what Caddy proxies
 * the public host to. The provisioner supervises it as a second systemd unit.
 *
 * Transport-agnostic: the runtime decides whether the sidecar is a native
 * process (e.g. a Python venv) or a container — `installSteps`/`renderSystemdUnit`
 * encapsulate that choice. Today's only sidecar (Open WebUI) is native.
 */
export type SidecarSpec = {
  /** systemd unit name (without ".service"), e.g. "open-webui". */
  serviceName: string
  /** Loopback port the sidecar binds; Caddy proxies the public host here. */
  port: number
  /** HTTP path the sidecar returns 200 on once ready. */
  healthPath: string
  /** Absolute filesystem path for persistent sidecar data (chowned to the sidecar user). */
  dataDir: string
  /** Absolute path of the sidecar's env file (referenced by its systemd unit). */
  envPath: string
  /** Bash install steps injected into the runtime bootstrap (package install, user creation, etc.). */
  installSteps(): string
  /** Build the sidecar's env file contents (key/value map). */
  renderEnv(args: SidecarEnvArgs): Record<string, string>
  /** systemd unit that runs the sidecar process. */
  renderSystemdUnit(): string
  /** Admin bootstrap: POST to this path to create the first (admin) account. */
  seedAdmin: { signupPath: string }
}

/** Inputs to a per-tool service's `.env` builder (e.g. n8n). */
export type ToolServiceEnvArgs = {
  instance: Instance
  /**
   * Public URL the instance is reached at (absolute links / webhooks behind the
   * Cloudflare/Caddy proxy). Null when the instance has no resolvable host yet.
   */
  publicUrl: string | null
  /** URL path prefix the service is mounted under, with trailing slash (e.g. "/n8n/"). */
  pathPrefix: string
  /**
   * Stable per-instance encryption key. Persisted encrypted and reused on every
   * reprovision — regenerating it would orphan any credentials the service has
   * already stored (n8n encrypts its saved credentials with this).
   */
  encryptionKey: string
  /** Seeded owner login, surfaced to the user and to the agent (browser control). */
  ownerEmail: string
  ownerPassword: string
}

/**
 * A self-hosted companion web app that a *tool* brings onto the box (n8n is the
 * first). Unlike `SidecarSpec` — which is one-per-runtime, gated by the
 * `webuiEnabled` boolean, and fronts the gateway — a `ToolService` is
 * provisioned per enabled catalog tool, independently toggleable at any time,
 * and mounted at its own URL subpath behind Caddy. The gateway (and any sidecar)
 * are left untouched; Caddy path-routes `caddyPathPrefix/*` to the service's
 * loopback port. Native process supervised by systemd — no Docker, matching the
 * rest of the stack.
 */
export type ToolService = {
  /** systemd unit name (without ".service"), e.g. "n8n". */
  serviceName: string
  /** Dedicated system user the process runs as (HOME=installDir). */
  systemUser: string
  /** Install / HOME dir, e.g. /opt/n8n. */
  installDir: string
  /** Persistent data dir (chowned to systemUser); holds the service's DB + state. */
  dataDir: string
  /** Loopback port the service binds; Caddy proxies `caddyPathPrefix/*` here. */
  port: number
  /** URL path prefix Caddy routes to this service, no trailing slash, e.g. "/n8n". */
  caddyPathPrefix: string
  /** HTTP path (absolute, including the prefix) the service returns 200 on once ready. */
  healthPath: string
  /** Absolute path of the service's env file (referenced by its systemd unit). */
  envPath: string
  /** Idempotent bash: create the system user + dirs and install the package. Run over SSH as root. */
  installSteps(): string
  /** Build the service's env file contents (key/value map). */
  renderEnv(args: ToolServiceEnvArgs): Record<string, string>
  /** systemd unit that runs the service process. */
  renderSystemdUnit(): string
  /**
   * Owner bootstrap: POST `buildPayload(...)` to `setupPath` (under the prefix)
   * to create the first (owner) account. Idempotent handling (already-set-up ->
   * a 4xx we treat as success) lives in the provisioner's seed script.
   */
  seedOwner: {
    setupPath: string
    buildPayload(args: { email: string; password: string }): Record<string, unknown>
  }
}

/**
 * A runtime engine adapter. OpenClaw is a Node/npm CLI; Hermes is a Python
 * package installed into a venv. Both expose a gateway listening on a single
 * loopback port behind Caddy, supervised by a systemd unit. Everything that
 * differs between them is captured here so the provisioner stays
 * runtime-agnostic.
 */
export interface RuntimeEngine {
  id: RuntimeId
  /** Human-facing name shown in the dashboard, e.g. "OpenClaw" / "Hermes". */
  displayName: string
  /** Package identifier (npm for OpenClaw, PyPI for Hermes) — informational. */
  npmPackage: string
  /** Pinned version, resolved lazily from env (OPENCLAW_VERSION / HERMES_VERSION). */
  version: () => string
  /** Minimum Node major.minor.patch required (both runtimes use Node 22 at runtime). */
  minNode: string
  /** Loopback port the gateway binds; Caddy proxies external traffic to it. */
  gatewayPort: number
  /** systemd unit name (without ".service"). */
  serviceName: string
  /** Absolute path to the installed CLI binary, e.g. /usr/bin/openclaw or /opt/hermes/venv/bin/hermes. */
  cliBinary: string
  /** Subcommand + flags appended to cliBinary for ExecStart, e.g. "gateway run". */
  gatewayArgs: string
  /** HTTP path the gateway returns 200 on; OpenClaw="/", Hermes="/health". */
  healthPath: string
  paths: RuntimeWorkspacePaths
  /**
   * When true, the provisioner does NOT write a hand-rendered config file for this runtime —
   * the runtime initializes its own config via `renderInitScript` (Hermes drives the official
   * `hermes config set` CLI so the on-disk schema always matches the installed package). The
   * `.env` is still written in Phase A. OpenClaw leaves this undefined → config is written.
   */
  managesOwnConfig?: boolean
  buildEnv(args: BuildEnvArgs): Record<string, string>
  renderConfig(args: RenderConfigArgs): string
  renderCaddyfile(args: RenderCaddyfileArgs): string
  renderSystemdUnit(): string
  /**
   * Optional bash run over SSH (as root) AFTER the `.env` is written and BEFORE the gateway
   * service starts. Must be non-interactive and idempotent (it re-runs on provision retries
   * and on reprovision). Returns null to skip. Hermes uses this to scaffold + validate its
   * config with `hermes setup --non-interactive`, `hermes config set`, `config check`, and
   * `doctor`. A non-zero exit fails the provision (→ rollback).
   */
  renderInitScript?(args: RenderInitScriptArgs): string | null
  /** Full cloud-init bootstrap script — runtime-specific install steps inside the shared framing. */
  renderBootstrap(args: BootstrapRenderArgs): string
  /**
   * Optional Docker sidecar fronting the gateway (Hermes → Open WebUI).
   * Undefined for runtimes that ship their own UI (OpenClaw). Only provisioned
   * when the instance has `webuiEnabled`.
   */
  sidecar?: SidecarSpec
}
