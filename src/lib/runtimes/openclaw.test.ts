import { describe, it, expect } from "vitest"

import { openclawRuntime, OPENCLAW_VPS_MIN_NODE } from "./openclaw"

/**
 * The published `openclaw` package declares `engines.node` as
 * `>=24.16.0 <25 || >=26.1.0`, and the bootstrap installs it with
 * `--engine-strict`, so npm hard-fails rather than warning when the box's Node
 * does not satisfy that range.
 *
 * These are static guards, not a registry lookup (unit tests do no network).
 * They exist because the drift between these two numbers is what produced an
 * endless warm-pool create/fail/destroy loop, and broke every cold VPS and BYOS
 * OpenClaw install at the same time. If OpenClaw raises its floor again, update
 * OPENCLAW_VPS_MIN_NODE and these bounds together.
 */
const ENGINES_FLOOR = [24, 16, 0] as const
const ENGINES_EXCLUDED_MAJOR = 25

function parts(v: string): number[] {
  return v.split(".").map((x) => Number.parseInt(x, 10) || 0)
}

describe("OpenClaw VPS Node floor", () => {
  it("is at least the version the package's engines field requires", () => {
    const [maj, min, pat] = parts(OPENCLAW_VPS_MIN_NODE)
    const [fMaj, fMin, fPat] = ENGINES_FLOOR
    expect(
      maj > fMaj || (maj === fMaj && (min > fMin || (min === fMin && pat >= fPat))),
      `OPENCLAW_VPS_MIN_NODE ${OPENCLAW_VPS_MIN_NODE} is below the engines floor ${ENGINES_FLOOR.join(".")}`,
    ).toBe(true)
  })

  it("is not in the major the engines range excludes", () => {
    expect(parts(OPENCLAW_VPS_MIN_NODE)[0]).not.toBe(ENGINES_EXCLUDED_MAJOR)
  })

  it("makes the bootstrap install a Node that can actually run OpenClaw", () => {
    const script = openclawRuntime.renderBootstrap({
      gatewayPort: openclawRuntime.gatewayPort,
      webuiEnabled: false,
    })
    const installedMajor = Number(script.match(/setup_(\d+)\.x/)?.[1])
    expect(installedMajor).toBeGreaterThanOrEqual(ENGINES_FLOOR[0])
    expect(installedMajor).not.toBe(ENGINES_EXCLUDED_MAJOR)
    // --engine-strict is deliberate: installing onto the wrong Node would
    // produce a broken agent, so failing the bake is the correct outcome.
    expect(script).toContain("--engine-strict")
  })

  it("does not retry an engine mismatch", () => {
    // Observed in production: three identical EBADENGINE attempts per bake.
    // Retrying a deterministic refusal wastes ~25s and, worse, fills the
    // bounded bootstrap.log tail with three copies of the same error, pushing
    // out the context above it that names the step and the versions.
    const script = openclawRuntime.renderBootstrap({
      gatewayPort: openclawRuntime.gatewayPort,
      webuiEnabled: false,
    })
    expect(script).toContain("EBADENGINE")
    expect(script).toContain("not retrying")
    // The transient-failure retry loop must survive alongside it.
    expect(script).toContain("npm install attempt $a/$max")
    expect(script).toContain("npm cache clean --force")
  })
})

describe("OpenClaw bootstrap — browser dependencies are opt-in", () => {
  // Chrome is a 142MB .deb plus its own `apt-get update`, and it used to go on
  // every box unconditionally. Tools are opt-in (agent-tools.ts has no
  // `defaultEnabled`), and installToolDependencies() installs the identical
  // set on demand when the tool is switched on later — so a box with no
  // chromium tool should never pay for it during provisioning.
  const render = (browserDeps?: boolean) =>
    openclawRuntime.renderBootstrap({
      gatewayPort: openclawRuntime.gatewayPort,
      webuiEnabled: false,
      ...(browserDeps === undefined ? {} : { browserDeps }),
    })

  it("omits Chrome when no enabled tool needs it", () => {
    const script = render(false)
    expect(script).not.toContain("google-chrome-stable")
    expect(script).not.toContain("install_chrome")
  })

  it("installs Chrome when a tool does need it", () => {
    const script = render(true)
    expect(script).toContain("google-chrome-stable")
    expect(script).toContain("install_chrome")
  })

  // Omitting the flag must keep the old behaviour: the warm pool renders with
  // no instance to read tools from, and a pooled VM must stay claim-ready.
  it("defaults to installing Chrome when the flag is omitted", () => {
    expect(render()).toContain("google-chrome-stable")
  })

  it("still installs the runtime itself either way", () => {
    for (const script of [render(false), render(true)]) {
      expect(script).toContain("install_runtime")
      expect(script).toContain("verify_runtime_cli")
    }
  })
})

describe("OpenClaw bootstrap — version pinning", () => {
  // The BYOS prebake downloads the package at connect and installs it at
  // deploy. If the install resolved `latest` a second time, a release landing
  // in between would turn the warm cache into a miss and the prefetch would
  // have bought nothing. The pin is what makes "download now, install later"
  // work at all.
  it("installs the resolved pin when one is supplied", () => {
    const script = openclawRuntime.renderBootstrap({
      gatewayPort: openclawRuntime.gatewayPort,
      webuiEnabled: false,
      runtimeVersion: "2026.9.5",
    })
    expect(script).toContain("openclaw@2026.9.5")
    expect(script).not.toContain("openclaw@latest")
  })

  it("falls back to today's behaviour with no pin", () => {
    const script = openclawRuntime.renderBootstrap({
      gatewayPort: openclawRuntime.gatewayPort,
      webuiEnabled: false,
    })
    expect(script).toContain("openclaw@latest")
  })
})
