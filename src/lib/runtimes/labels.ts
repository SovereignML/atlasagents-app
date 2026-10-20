import type { RuntimeId } from "./types"

/**
 * Client-safe runtime metadata. The full runtime adapters (and `getRuntime`)
 * transitively import `node:crypto` via `shared.ts`, so they cannot be pulled
 * into client components. This module has no Node imports and is safe in both
 * server and client code.
 *
 * Code that needs to know what an engine *can do* asks here instead of testing
 * `runtime === "hermes"`. Each adapter exposes its row as `engine.caps`, and
 * `labels.test.ts` keeps `label` equal to the adapter's `displayName`.
 */

/** Hermes rejects any model with <64k context at startup. */
export const HERMES_MIN_CONTEXT = 64_000

export type RuntimeCaps = {
  /** Human-facing name, e.g. "OpenClaw". Equal to the adapter's `displayName`. */
  label: string
  /** One line under the name in the deploy wizards. */
  hint: string
  /**
   * Smallest plan (GB RAM) this engine is offered on; 0 = no floor. OpenClaw
   * must stay 0: the BYOS plan's server config (`byos-managed`) reports 0 GB.
   */
  minRamGb: number
  /**
   * Serves an OpenAI-compatible API at `/v1` behind the gateway token. The
   * provisioner gates the deploy on `GET /v1/models`, and the dashboard calls
   * the token a "Gateway API Key" and leads with the chat UI login.
   */
  exposesOpenAiApi: boolean
  /**
   * The engine ships its own email/password login (OpenClaw's Control UI).
   * Engines without one only get admin credentials when a sidecar needs them.
   */
  nativeAdminLogin: boolean
  /**
   * Can target an arbitrary OpenAI-compatible base URL, so a customer may bring
   * a non-OpenRouter key (see `requiresHermes` in configs/llm-providers.ts).
   */
  supportsCustomBaseUrl: boolean
  /**
   * New instances get the chat UI sidecar (AgentWebUI Lite). Engines without a
   * sidecar always store `webuiEnabled=false`.
   */
  hasSidecar: boolean
  /** Minimum model context window the engine accepts, when it has one. */
  minContext?: number
  /**
   * OpenRouter slug prefixes the engine can drive, e.g. `["anthropic/"]` —
   * Claude Code speaks the Anthropic Messages API, so only Claude models work.
   * Absent ⇒ any allowed chat model. Filters the per-instance model picker.
   */
  modelSlugPrefixes?: string[]
  /**
   * Ships a login-protected browser terminal at `/terminal` running the
   * engine's own TUI (ttyd + tmux). Its login is the chat UI's admin account,
   * so the admin credentials must reach the env on every (re)provision.
   */
  hasTerminal: boolean
  /** Offered on the Free plan (which has one live agent per engine). */
  allowedOnFree: boolean
  /**
   * Behind `CLI_RUNTIMES_ENABLED`: hidden from, and rejected for, everyone but
   * platform admins until the flag is on. See `runtimeAvailableTo`.
   */
  beta?: boolean
}

export const RUNTIME_CAPS: Record<RuntimeId, RuntimeCaps> = {
  openclaw: {
    label: "OpenClaw",
    hint: "Default agent runtime",
    minRamGb: 0,
    exposesOpenAiApi: false,
    nativeAdminLogin: true,
    supportsCustomBaseUrl: false,
    hasSidecar: false,
    hasTerminal: false,
    allowedOnFree: true,
  },
  hermes: {
    label: "Hermes",
    hint: "Nous Research Hermes (Python)",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: true,
    hasSidecar: true,
    minContext: HERMES_MIN_CONTEXT,
    hasTerminal: false,
    allowedOnFree: true,
  },
  "claude-code": {
    label: "Claude Code",
    hint: "Anthropic's coding agent, with a browser terminal",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: false,
    hasSidecar: true,
    modelSlugPrefixes: ["anthropic/"],
    hasTerminal: true,
    allowedOnFree: false,
    beta: true,
  },
  codex: {
    label: "Codex",
    hint: "OpenAI's coding agent, with a browser terminal",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: false,
    hasSidecar: true,
    modelSlugPrefixes: ["openai/"],
    hasTerminal: true,
    allowedOnFree: false,
    beta: true,
  },
  // OpenCode and Pi drive any OpenRouter model, so no slug prefix, but with
  // Hermes' context floor: a coding agent's system prompt and tool schemas do
  // not fit a short window. Beta, like the other CLI engines; Pi's ACP adapter
  // is a community one (pi-acp).
  opencode: {
    label: "OpenCode",
    hint: "The open-source coding agent, any model, with a browser terminal",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: false,
    hasSidecar: true,
    minContext: HERMES_MIN_CONTEXT,
    hasTerminal: true,
    allowedOnFree: false,
    beta: true,
  },
  pi: {
    label: "Pi",
    hint: "A minimal coding agent, any model, with a browser terminal",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: false,
    hasSidecar: true,
    minContext: HERMES_MIN_CONTEXT,
    hasTerminal: true,
    allowedOnFree: false,
    beta: true,
  },
  // Google's and xAI's own coding agents, each on its own vendor's models
  // (through OpenRouter, like every engine), and offered on Free. Gemini CLI
  // speaks only Gemini's API, which the Atlas gateway translates on the box.
  "gemini-cli": {
    label: "Gemini CLI",
    hint: "Google's coding agent on Gemini models, with a browser terminal",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: false,
    hasSidecar: true,
    minContext: HERMES_MIN_CONTEXT,
    modelSlugPrefixes: ["google/"],
    hasTerminal: true,
    allowedOnFree: true,
    beta: true,
  },
  grok: {
    label: "Grok",
    hint: "xAI's coding agent on Grok models, with a browser terminal",
    minRamGb: 2,
    exposesOpenAiApi: true,
    nativeAdminLogin: false,
    supportsCustomBaseUrl: false,
    hasSidecar: true,
    minContext: HERMES_MIN_CONTEXT,
    modelSlugPrefixes: ["x-ai/"],
    hasTerminal: true,
    allowedOnFree: true,
    beta: true,
  },
}

/** Default for NULL / unknown ids — mirrors `getRuntime()`'s fallback. */
const FALLBACK_RUNTIME_ID: RuntimeId = "openclaw"

/** True when `id` names a known runtime. */
export function isRuntimeId(id: string | null | undefined): id is RuntimeId {
  return !!id && Object.prototype.hasOwnProperty.call(RUNTIME_CAPS, id)
}

/** Capabilities for a runtime id, coercing NULL / unknown to OpenClaw. */
export function runtimeCaps(id: string | null | undefined): RuntimeCaps {
  return RUNTIME_CAPS[isRuntimeId(id) ? id : FALLBACK_RUNTIME_ID]
}

/**
 * Whether a viewer may pick this engine. Beta engines need the
 * `CLI_RUNTIMES_ENABLED` flag (resolved server-side and passed in, so this stays
 * client-safe) unless the viewer is a platform admin.
 */
export function runtimeAvailableTo(
  id: string | null | undefined,
  viewer: { betaEnabled: boolean; isAdmin: boolean },
): boolean {
  if (!isRuntimeId(id)) return false
  return !RUNTIME_CAPS[id].beta || viewer.betaEnabled || viewer.isAdmin
}

/** True when `slug` is a model the engine can drive (see `modelSlugPrefixes`). */
export function runtimeAcceptsModel(id: string | null | undefined, slug: string): boolean {
  const prefixes = runtimeCaps(id).modelSlugPrefixes
  return !prefixes || prefixes.some((p) => slug.startsWith(p))
}

/** Client-safe display labels, derived from `RUNTIME_CAPS`. */
export const RUNTIME_LABELS = Object.fromEntries(
  Object.entries(RUNTIME_CAPS).map(([id, caps]) => [id, caps.label]),
) as Record<RuntimeId, string>

/** Resolve a runtime id to its display label, defaulting to OpenClaw. */
export function runtimeLabel(id: string | null | undefined): string {
  return runtimeCaps(id).label
}

/** A warm-pool slot's label: an engine's own pool, or the universal image every chat-UI engine shares. */
export function poolRuntimeLabel(id: string | null | undefined): string {
  return id === "universal" ? "Universal (every engine but OpenClaw)" : runtimeLabel(id)
}
