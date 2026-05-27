/**
 * Compatibility shim. The runtime rendering logic moved to `src/lib/runtimes/`
 * (a runtime-engine abstraction shared by OpenClaw and Hermes). This file
 * re-exports the OpenClaw-specific constants and the runtime-agnostic helpers
 * so existing importers keep working. New code should import `getRuntime` from
 * `@/lib/runtimes` and use the adapter methods directly.
 */
import { openclawRuntime } from "@/lib/runtimes/openclaw"
import type {
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
} from "@/lib/runtimes/types"

export {
  OPENCLAW_VERSION,
  OPENCLAW_VPS_MIN_NODE,
  OPENCLAW_GATEWAY_PORT,
  OPENCLAW_SERVICE_NAME,
  openclawRuntime,
} from "@/lib/runtimes/openclaw"
export {
  generateAdminPassword,
  generateGatewayToken,
  renderEnvFile,
} from "@/lib/runtimes/shared"
export type { RenderCaddyfileArgs } from "@/lib/runtimes/types"

export type OpenclawEnv = Record<string, string>

export function buildOpenclawEnv(args: BuildEnvArgs): OpenclawEnv {
  return openclawRuntime.buildEnv(args)
}

export function renderOpenclawConfig(args: RenderConfigArgs): string {
  return openclawRuntime.renderConfig(args)
}

export function renderCaddyfile(args: RenderCaddyfileArgs): string {
  return openclawRuntime.renderCaddyfile(args)
}

export function renderSystemdUnit(): string {
  return openclawRuntime.renderSystemdUnit()
}
