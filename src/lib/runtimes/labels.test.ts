import { describe, expect, it } from "vitest"
import { RUNTIME_IDS } from "./ids"
import {
  HERMES_MIN_CONTEXT,
  RUNTIME_CAPS,
  RUNTIME_LABELS,
  isRuntimeId,
  runtimeCaps,
  runtimeLabel,
} from "./labels"
import { RUNTIMES, RUNTIME_LIST, getRuntime } from "./index"
import { AGENT_FOOTPRINTS, footprintKey, getFootprint } from "@/configs/agent-footprint"
import { RuntimeSchema } from "@/lib/agent-config"
import { effectiveModel, hermesModel } from "@/lib/model-router"

describe("runtime registry exhaustiveness", () => {
  it("has an engine, a caps row and a footprint for every id", () => {
    for (const id of RUNTIME_IDS) {
      expect(RUNTIMES[id].id).toBe(id)
      expect(RUNTIME_CAPS[id]).toBeDefined()
      expect(getFootprint(footprintKey(id, RUNTIME_CAPS[id].hasSidecar))).toBeDefined()
    }
    expect(RUNTIME_LIST.map((r) => r.id)).toEqual([...RUNTIME_IDS])
    expect(Object.keys(RUNTIME_CAPS)).toEqual([...RUNTIME_IDS])
  })

  it("exposes the same caps row on the engine", () => {
    for (const id of RUNTIME_IDS) {
      expect(getRuntime(id).caps).toBe(RUNTIME_CAPS[id])
    }
  })

  it("keeps the client-safe label equal to the adapter displayName", () => {
    for (const id of RUNTIME_IDS) {
      expect(RUNTIME_LABELS[id]).toBe(RUNTIMES[id].displayName)
    }
  })

  it("accepts exactly the registered ids in the agent-config schema", () => {
    for (const id of RUNTIME_IDS) expect(RuntimeSchema.safeParse(id).success).toBe(true)
    expect(RuntimeSchema.safeParse("nope").success).toBe(false)
  })

  it("has a footprint row only for keys the registry can produce", () => {
    const producible = new Set(
      RUNTIME_IDS.flatMap((id) => [footprintKey(id, false), footprintKey(id, true)]),
    )
    for (const fp of AGENT_FOOTPRINTS) expect(producible.has(fp.key)).toBe(true)
  })
})

describe("runtimeCaps()", () => {
  it("falls back to OpenClaw for NULL, unknown and prototype keys", () => {
    for (const id of [null, undefined, "", "nope", "toString", "__proto__"]) {
      expect(runtimeCaps(id)).toBe(RUNTIME_CAPS.openclaw)
      expect(runtimeLabel(id)).toBe("OpenClaw")
      expect(isRuntimeId(id)).toBe(false)
    }
  })

  it("preserves the historical Hermes/OpenClaw behaviour", () => {
    expect(runtimeCaps("hermes")).toMatchObject({
      minRamGb: 2,
      exposesOpenAiApi: true,
      nativeAdminLogin: false,
      supportsCustomBaseUrl: true,
      hasSidecar: true,
      minContext: HERMES_MIN_CONTEXT,
    })
    expect(runtimeCaps("openclaw")).toMatchObject({
      // 0, not 1: the BYOS plan's server config reports 0 GB RAM.
      minRamGb: 0,
      exposesOpenAiApi: false,
      nativeAdminLogin: true,
      supportsCustomBaseUrl: false,
      hasSidecar: false,
    })
    expect(runtimeCaps("openclaw").minContext).toBeUndefined()
  })
})

describe("footprintKey()", () => {
  it("adds -webui only for engines that ship a sidecar", () => {
    expect(footprintKey("hermes", true)).toBe("hermes-webui")
    expect(footprintKey("hermes", false)).toBe("hermes")
    expect(footprintKey("openclaw", true)).toBe("openclaw")
  })
})

describe("effectiveModel()", () => {
  const base = { llmProvider: "openrouter" as const, tier: "mid" as const, routedModel: "routed/x" }

  it("pins Hermes to its own ladder and everything else to the routed model", () => {
    expect(effectiveModel({ ...base, runtimeId: "hermes" })).toBe(hermesModel("mid"))
    expect(effectiveModel({ ...base, runtimeId: "openclaw" })).toBe("routed/x")
  })

  it("does not treat prototype keys as a ladder", () => {
    expect(effectiveModel({ ...base, runtimeId: "toString" })).toBe("routed/x")
    expect(effectiveModel({ ...base, runtimeId: "constructor" })).toBe("routed/x")
  })

  it("honours an explicit OpenRouter override on every runtime", () => {
    expect(effectiveModel({ ...base, runtimeId: "hermes", modelSlug: "a/b" })).toBe("a/b")
  })
})
