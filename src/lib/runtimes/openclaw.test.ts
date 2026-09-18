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
})
