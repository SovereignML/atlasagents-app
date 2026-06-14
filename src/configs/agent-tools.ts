import type { RuntimeId } from "@/lib/runtimes/types"

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
  /** Future cloud-provider variant needs an external API key (not used in v1). */
  requiresApiKey?: boolean
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
    description: "Let the agent search the web for up-to-date information.",
    comingSoon: true,
    support: {
      openclaw: { toolName: "web_search" },
      hermes: { toolset: "web" },
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
    id: "image_gen",
    name: "Image Generation",
    icon: "Image",
    description: "Let the agent generate images from text prompts.",
    comingSoon: true,
    support: {
      openclaw: null,
      hermes: { toolset: "image_gen" },
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
]

/** Look up a tool by its catalog id. */
export function getTool(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id)
}

/** True when `tool` is realizable on the given runtime. */
export function toolSupportedOn(tool: AgentTool, runtimeId: RuntimeId): boolean {
  return tool.support[runtimeId] != null
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
