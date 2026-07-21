import { describe, it, expect } from "vitest"
import {
  getTool,
  toolSupportedOn,
  expandAutoEnabledTools,
  toolServicesForIds,
} from "@/configs/agent-tools"

describe("n8n catalog entry", () => {
  it("exists with a companion service and no gateway allowlist entry", () => {
    const n8n = getTool("n8n")
    expect(n8n).toBeDefined()
    expect(n8n!.service).toBeDefined()
    expect(n8n!.support.openclaw).toBeNull()
    expect(n8n!.support.hermes).toBeNull()
    expect(n8n!.comingSoon).toBeFalsy()
  })

  it("is supported on both runtimes (service tools are host-side)", () => {
    const n8n = getTool("n8n")!
    expect(toolSupportedOn(n8n, "openclaw")).toBe(true)
    expect(toolSupportedOn(n8n, "hermes")).toBe(true)
  })
})

describe("expandAutoEnabledTools", () => {
  it("pulls in browser when n8n is enabled, de-duped and order-preserving", () => {
    expect(expandAutoEnabledTools(["n8n"])).toEqual(["n8n", "browser"])
    expect(expandAutoEnabledTools(["n8n", "browser"])).toEqual(["n8n", "browser"])
    expect(expandAutoEnabledTools(["browser", "n8n"])).toEqual(["browser", "n8n"])
  })

  it("is a no-op for tools without autoEnables", () => {
    expect(expandAutoEnabledTools(["web_search"])).toEqual(["web_search"])
    expect(expandAutoEnabledTools([])).toEqual([])
  })
})

describe("toolServicesForIds", () => {
  it("resolves the n8n service and ignores non-service tools", () => {
    const services = toolServicesForIds(["browser", "n8n", "knowledge_base"])
    expect(services).toHaveLength(1)
    expect(services[0].serviceName).toBe("n8n")
  })
})
