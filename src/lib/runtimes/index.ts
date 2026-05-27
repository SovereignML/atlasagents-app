import { openclawRuntime } from "./openclaw"
import { hermesRuntime } from "./hermes"
import type { RuntimeEngine, RuntimeId } from "./types"

export const RUNTIMES: Record<RuntimeId, RuntimeEngine> = {
  openclaw: openclawRuntime,
  hermes: hermesRuntime,
}

/** All selectable runtimes, in display order, for UI menus. */
export const RUNTIME_LIST: RuntimeEngine[] = [openclawRuntime, hermesRuntime]

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
