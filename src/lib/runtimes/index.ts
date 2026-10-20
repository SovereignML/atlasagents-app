import { openclawRuntime } from "./openclaw"
import { hermesRuntime } from "./hermes"
import { claudeCodeRuntime } from "./claude-code"
import { codexRuntime } from "./codex"
import { opencodeRuntime } from "./opencode"
import { piRuntime } from "./pi"
import type { RuntimeEngine, RuntimeId } from "./types"

export const RUNTIMES: Record<RuntimeId, RuntimeEngine> = {
  openclaw: openclawRuntime,
  hermes: hermesRuntime,
  "claude-code": claudeCodeRuntime,
  codex: codexRuntime,
  opencode: opencodeRuntime,
  pi: piRuntime,
}

/** All selectable runtimes, in display order, for UI menus. */
export const RUNTIME_LIST: RuntimeEngine[] = [
  openclawRuntime,
  hermesRuntime,
  claudeCodeRuntime,
  codexRuntime,
  opencodeRuntime,
  piRuntime,
]

/** Default runtime for instances with no explicit choice (backward compat). */
export const DEFAULT_RUNTIME_ID: RuntimeId = "openclaw"

/**
 * Resolve a runtime by id, coercing null / undefined / unknown values to the
 * default (openclaw). Existing instance rows predate the `runtime` column and
 * read back NULL, so they must keep provisioning as OpenClaw.
 */
export function getRuntime(id: string | null | undefined): RuntimeEngine {
  if (id && id in RUNTIMES) return RUNTIMES[id as RuntimeId]
  return RUNTIMES[DEFAULT_RUNTIME_ID]
}

export type { RuntimeEngine, RuntimeId } from "./types"
export { createRuntime, generateAdminPassword, generateGatewayToken, renderEnvFile } from "./shared"
