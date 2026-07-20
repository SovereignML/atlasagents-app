import type { RuntimeId, ToolService } from "@/lib/runtimes/types"
import { n8nToolService } from "@/lib/runtimes/n8n-service"

/**
 * Per-runtime realization of a tool. `null` means the tool is not available on
 * that runtime — `enabledToolsForRuntime` filters those out so a tool that only
 * one runtime supports silently no-ops on the other instead of breaking the
 * config render.
 */
export type ToolRuntimeSupport = {
  /** OpenClaw: tool name granted in `tools.alsoAllow` (e.g. "browser"). */
  openclaw: { toolName: string } | null
  /** Hermes: toolset id added to config.yaml `toolsets` (e.g. "browser"). */
  hermes: { toolset: string } | null
}

/**
 * A user-installable agent tool. Stored on the instance as a flat array of
 * `id`s (`instances.enabledTools`). The catalog maps each id to how it's
 * realized on each runtime plus the system dependencies it needs, so both the
 * runtime config render and the over-SSH dependency install can be derived from
 * a single source of truth.
 */
export type AgentTool = {
  /** Stable id stored in `instances.enabledTools`, e.g. "browser". */
  id: string
  /** Human-facing name shown in the Tools tab. */
  name: string
  /** lucide-react icon name (same convention as agent-categories). */
  icon: string
  description: string
  /**
   * Listed in the catalog but not yet wired end-to-end — the UI shows it with a
   * disabled toggle + "Coming soon" badge and the API rejects enabling it.
   */
  comingSoon?: boolean
  /** Needs a Chromium-family binary on the box (drives the Chromium install). */
  requiresChromium?: boolean
  /** Extra global npm package(s) the box needs, per runtime (e.g. agent-browser). */
  requiresNpmGlobal?: { hermes?: string; openclaw?: string }
  /**
   * The tool's provider needs an external API key to function. Shown as a hint
   * in the UI; the key itself is configured separately (platform/team env).
   */
  requiresApiKey?: boolean
  /**
   * Host-side knowledge capability: the agent reads reference material synced
   * into its `workspace/knowledge/` directory (see src/lib/provisioner.ts). This
   * is runtime-agnostic — it adds no entry to the runtime's tool allowlist, so a
   * tool with this flag is "supported" on every runtime even when both
   * `support` entries are null. See `toolSupportedOn`.
   */
  providesKnowledge?: boolean
  /**
   * A self-hosted companion web app this tool provisions on the box (e.g. n8n),
   * mounted at its own URL subpath behind Caddy and supervised by systemd. Like
   * `providesKnowledge`, this is realized outside the runtime's tool allowlist,
   * so a tool with a `service` is "supported" on every runtime even with both
   * `support` entries null. See `ToolService` and `syncToolServices`.
   */
  service?: ToolService
  /**
   * Catalog ids this tool implicitly turns on (server-side) when enabled. n8n
   * uses this to pull in `browser`, since the agent controls n8n by driving its
   * web UI through the browser tool.
   */
  autoEnables?: string[]
  support: ToolRuntimeSupport
}

/**
 * The tool catalog. v1 ships **browser** end-to-end (local Chromium on both
 * runtimes); the rest are scaffolded `comingSoon` entries — the generic render
 * already supports config-only tools (web_search, code) so promoting them later
 * is mostly removing the flag + testing. image_gen and mcp need richer config
 * and stay deferred.
 */
export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    id: "browser",
    name: "Web Browser",
    icon: "Globe",
    description:
      "Let the agent open web pages, navigate, click, and read live content.",
    requiresChromium: true,
    requiresNpmGlobal: { hermes: "agent-browser" },
    support: {
      openclaw: { toolName: "browser" },
      hermes: { toolset: "browser" },
    },
  },
  {
    id: "web_search",
    name: "Web Search",
    icon: "Search",
    description:
      "Let the agent search the web for up-to-date information. May require a search-provider API key.",
    requiresApiKey: true,
    support: {
      openclaw: { toolName: "web_search" },
      hermes: { toolset: "web" },
    },
  },
  {
    id: "knowledge_base",
    name: "Knowledge Base",
    icon: "BookOpen",
    description:
      "Train the agent on your business: upload documents and add URLs the agent consults (and cites) when answering.",
    providesKnowledge: true,
    support: {
      // Realized host-side (files synced into workspace/knowledge/ + prompt
      // guidance), not via a runtime tool allowlist entry.
      openclaw: null,
      hermes: null,
    },
  },
  {
    id: "image_gen",
    name: "Image Generation",
    icon: "Image",
    description:
      "Let the agent generate images from text prompts (Hermes only). Requires an image-provider API key.",
    requiresApiKey: true,
    support: {
      openclaw: null,
      hermes: { toolset: "image_gen" },
    },
  },
  {
    id: "code",
    name: "Code & Terminal",
    icon: "Terminal",
    description:
      "Let the agent run shell commands and execute code in a sandbox.",
    comingSoon: true,
    support: {
      openclaw: { toolName: "exec" },
      hermes: { toolset: "terminal" },
    },
  },
  {
    id: "mcp",
    name: "MCP Servers",
    icon: "Plug",
    description:
      "Attach Model Context Protocol servers (Gmail, Slack, custom tools).",
    comingSoon: true,
    support: {
      openclaw: { toolName: "bundle-mcp" },
      hermes: { toolset: "mcp" },
    },
  },
  {
    id: "n8n",
    name: "n8n",
    icon: "Workflow",
    description:
      "Give the agent a self-hosted n8n automation server with its own web UI. The agent builds and runs workflows by driving the n8n interface.",
    // The agent controls n8n by operating its web UI, so it needs the browser
    // (and the Chromium it drives). Enabling n8n auto-enables the browser tool.
    requiresChromium: true,
    autoEnables: ["browser"],
    // Realized as a self-hosted companion service (systemd + Caddy `/n8n/`),
    // not a runtime tool-allowlist entry — hence both `support` sides are null.
    service: n8nToolService,
    support: {
      openclaw: null,
      hermes: null,
    },
  },
]

/** Look up a tool by its catalog id. */
export function getTool(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id)
}

/** True when `tool` is realizable on the given runtime. */
export function toolSupportedOn(tool: AgentTool, runtimeId: RuntimeId): boolean {
  // Host-side tools (Knowledge Base, or a companion `service` like n8n) work on
  // every runtime — they don't add a runtime allowlist entry — so they're
  // "supported" even with both `support` null.
  return (
    tool.providesKnowledge === true ||
    tool.service != null ||
    tool.support[runtimeId] != null
  )
}

/**
 * Expand an enabled-tool id list with any ids implied by `autoEnables`
 * (e.g. n8n -> browser). Order-preserving and de-duped; implied ids are
 * appended after the explicit ones. Applied server-side when tools are saved so
 * the runtime render + dep install treat the implied tool as enabled.
 */
export function expandAutoEnabledTools(ids: string[]): string[] {
  const out = [...ids]
  const seen = new Set(ids)
  for (const id of ids) {
    for (const implied of getTool(id)?.autoEnables ?? []) {
      if (!seen.has(implied)) {
        seen.add(implied)
        out.push(implied)
      }
    }
  }
  return out
}

/** The per-tool companion services (e.g. n8n) implied by an enabled-tool id list. */
export function toolServicesForIds(ids: string[]): ToolService[] {
  return ids
    .map((id) => getTool(id)?.service)
    .filter((s): s is ToolService => !!s)
}

/** True when the given enabled-tool ids include a host-side Knowledge Base tool. */
export function knowledgeBaseEnabled(ids: string[]): boolean {
  return ids.some((id) => getTool(id)?.providesKnowledge === true)
}

/**
 * Resolve enabled tool ids to the catalog tools that are actually usable on the
 * given runtime — drops unknown ids, `comingSoon` tools, and tools unsupported
 * on this runtime. Used by both the runtime config renderers and the
 * dependency installer so a stale/mismatched id can never break a provision.
 */
export function enabledToolsForRuntime(
  ids: string[],
  runtimeId: RuntimeId,
): AgentTool[] {
  return ids
    .map((id) => getTool(id))
    .filter((t): t is AgentTool => !!t && !t.comingSoon && toolSupportedOn(t, runtimeId))
}
