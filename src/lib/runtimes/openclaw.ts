import { createRuntime } from "./shared"

/**
 * The OpenClaw release new boxes install. Deliberately one release behind
 * npm's `latest` (2026.9.9 at the time of pinning): openclaw ships every few
 * days, and a release should reach customers after it has soaked, not the
 * minute it is published. Bump it on purpose, after a test deploy — see
 * "Version pinning" in docs/RUNTIMES.md.
 *
 * `OPENCLAW_VERSION` still overrides it (a version, or `latest` to track
 * upstream again), which is how a bad pin is rolled back without a code deploy.
 */
export const OPENCLAW_PINNED_VERSION = "2026.9.8"

export const OPENCLAW_VERSION = () => process.env.OPENCLAW_VERSION || OPENCLAW_PINNED_VERSION

/**
 * Minimum Node on VPS. Must satisfy the published package's `engines` field,
 * because the bootstrap installs with `--engine-strict` — npm hard-fails rather
 * than warning on a mismatch.
 *
 * `openclaw@2026.9.4` declares `>=24.16.0 <25 || >=26.1.0`. This was 22.14.0,
 * which the bootstrap's own `verify_node` step happily accepted (Node 22 does
 * satisfy 22.14.0) before npm refused to install the package at all —
 * EBADENGINE at the `install_runtime` step, on every fresh OpenClaw box.
 *
 * This value also selects the NodeSource distribution the bootstrap installs
 * (see nodeSourceMajor in bootstrap.ts), so 24.x here means the box gets Node
 * 24. Do not raise it into 25.x: the engines range excludes it.
 */
export const OPENCLAW_VPS_MIN_NODE = "24.16.0"

export const OPENCLAW_GATEWAY_PORT = 18789
export const OPENCLAW_SERVICE_NAME = "openclaw-gateway"

const OPENCLAW_INSTALL_DIR = "/opt/openclaw"
const OPENCLAW_COMPILE_CACHE_DIR = "/var/tmp/openclaw-compile-cache"

export const openclawRuntime = createRuntime({
  id: "openclaw",
  displayName: "OpenClaw",
  npmPackage: "openclaw",
  registry: "npm",
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
