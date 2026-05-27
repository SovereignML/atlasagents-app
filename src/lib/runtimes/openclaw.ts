import { createRuntime } from "./shared"

export const OPENCLAW_VERSION = () => process.env.OPENCLAW_VERSION || "latest"

/** Minimum Node on VPS; must satisfy OpenClaw CLI / package engines (bootstrap verifies). */
export const OPENCLAW_VPS_MIN_NODE = "22.14.0"

export const OPENCLAW_GATEWAY_PORT = 18789
export const OPENCLAW_SERVICE_NAME = "openclaw-gateway"

const OPENCLAW_INSTALL_DIR = "/opt/openclaw"
const OPENCLAW_COMPILE_CACHE_DIR = "/var/tmp/openclaw-compile-cache"

export const openclawRuntime = createRuntime({
  id: "openclaw",
  displayName: "OpenClaw",
  npmPackage: "openclaw",
  version: OPENCLAW_VERSION,
  minNode: OPENCLAW_VPS_MIN_NODE,
  gatewayPort: OPENCLAW_GATEWAY_PORT,
  serviceName: OPENCLAW_SERVICE_NAME,
  cliBinary: "/usr/bin/openclaw",
  gatewayArgs: "gateway --allow-unconfigured",
  envPrefix: "OPENCLAW",
  serviceEnv: [
    `NODE_COMPILE_CACHE=${OPENCLAW_COMPILE_CACHE_DIR}`,
    "OPENCLAW_NO_RESPAWN=1",
  ],
  installDir: OPENCLAW_INSTALL_DIR,
  configSubdir: ".openclaw",
  configFileName: "openclaw.json",
  systemUser: "openclaw",
  compileCacheDir: OPENCLAW_COMPILE_CACHE_DIR,
  healthPath: "/",
})
