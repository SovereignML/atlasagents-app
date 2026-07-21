import { describe, it, expect } from "vitest"
import { openclawRuntime } from "@/lib/runtimes/openclaw"
import { hermesRuntime } from "@/lib/runtimes/hermes"
import { N8N_PORT, N8N_PATH_PREFIX } from "@/lib/runtimes/n8n-service"

const managed = { domain: null, managedSubdomain: "x.test" }
const n8nRoute = [{ pathPrefix: N8N_PATH_PREFIX, port: N8N_PORT }]

describe("OpenClaw renderCaddyfile — tool-service routes", () => {
  it("is byte-identical when toolServices is empty vs omitted", () => {
    const omitted = openclawRuntime.renderCaddyfile({ ...managed })
    const empty = openclawRuntime.renderCaddyfile({ ...managed, toolServices: [] })
    expect(empty).toBe(omitted)
    // The historical bare reverse_proxy is preserved (no `handle` wrapping).
    expect(omitted).not.toContain("handle")
  })

  it("routes /n8n/* ahead of the gateway catch-all when n8n is present", () => {
    const out = openclawRuntime.renderCaddyfile({
      ...managed,
      toolServices: n8nRoute,
    })
    expect(out).toContain("handle /n8n/* {")
    expect(out).toContain(`reverse_proxy localhost:${N8N_PORT}`)
    // Gateway now lives under a catch-all handle.
    expect(out).toContain("handle {")
    expect(out).toContain(`reverse_proxy localhost:${openclawRuntime.gatewayPort}`)
    // /n8n/* must precede the catch-all (Caddy `handle` is first-match).
    expect(out.indexOf("handle /n8n/* {")).toBeLessThan(out.indexOf("handle {"))
    // Still one site block for the managed host.
    expect(out).toContain("x.test {")
  })

  it("produces a Caddyfile with balanced braces", () => {
    const out = openclawRuntime.renderCaddyfile({
      ...managed,
      toolServices: n8nRoute,
    })
    const opens = (out.match(/{/g) ?? []).length
    const closes = (out.match(/}/g) ?? []).length
    expect(opens).toBe(closes)
  })
})

describe("Hermes renderCaddyfile — tool-service routes", () => {
  it("is byte-identical when toolServices is empty vs omitted (single-upstream)", () => {
    const omitted = hermesRuntime.renderCaddyfile({ ...managed })
    const empty = hermesRuntime.renderCaddyfile({ ...managed, toolServices: [] })
    expect(empty).toBe(omitted)
  })

  it("is byte-identical when toolServices is empty vs omitted (dual-route)", () => {
    const omitted = hermesRuntime.renderCaddyfile({ ...managed, upstreamPort: 8080 })
    const empty = hermesRuntime.renderCaddyfile({
      ...managed,
      upstreamPort: 8080,
      toolServices: [],
    })
    expect(empty).toBe(omitted)
  })

  it("adds /n8n/* ahead of /v1/* and the sidecar catch-all (dual-route)", () => {
    const out = hermesRuntime.renderCaddyfile({
      ...managed,
      upstreamPort: 8080,
      toolServices: n8nRoute,
    })
    expect(out).toContain("handle /n8n/* {")
    expect(out).toContain(`reverse_proxy localhost:${N8N_PORT}`)
    // Ordering: n8n, then /v1/*, then the catch-all sidecar route.
    expect(out.indexOf("handle /n8n/* {")).toBeLessThan(out.indexOf("handle /v1/* {"))
    expect(out).toContain("reverse_proxy localhost:8080")
  })

  it("routes /n8n/* on a legacy single-upstream host too", () => {
    const out = hermesRuntime.renderCaddyfile({ ...managed, toolServices: n8nRoute })
    expect(out).toContain("handle /n8n/* {")
    expect(out).toContain(`reverse_proxy localhost:${N8N_PORT}`)
  })
})
