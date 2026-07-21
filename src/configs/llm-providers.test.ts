import { describe, it, expect } from "vitest"
import {
  BYO_LLM_PROVIDERS,
  getByoProvider,
  isByoProviderId,
  resolveByoBaseUrl,
  isOpenRouterProvider,
  requiresHermes,
} from "@/configs/llm-providers"
import { OPENROUTER_BASE_URL } from "@/lib/model-router"

describe("BYO LLM provider catalog", () => {
  it("has exactly one OpenRouter provider and it is the only openRouter=true entry", () => {
    const openRouter = BYO_LLM_PROVIDERS.filter((p) => p.openRouter)
    expect(openRouter).toHaveLength(1)
    expect(openRouter[0].id).toBe("openrouter")
  })

  it("only the custom provider has a null base URL", () => {
    for (const p of BYO_LLM_PROVIDERS) {
      if (p.id === "custom") expect(p.baseUrl).toBeNull()
      else expect(p.baseUrl).toBeTruthy()
    }
  })

  it("getByoProvider resolves known ids and rejects unknown", () => {
    expect(getByoProvider("openai")?.id).toBe("openai")
    expect(getByoProvider("nope")).toBeNull()
    expect(getByoProvider(null)).toBeNull()
  })

  it("isByoProviderId narrows valid ids", () => {
    expect(isByoProviderId("groq")).toBe(true)
    expect(isByoProviderId("bogus")).toBe(false)
    expect(isByoProviderId(undefined)).toBe(false)
  })
})

describe("isOpenRouterProvider / requiresHermes", () => {
  it("treats null/undefined/openrouter as OpenRouter (back-compat)", () => {
    expect(isOpenRouterProvider(null)).toBe(true)
    expect(isOpenRouterProvider(undefined)).toBe(true)
    expect(isOpenRouterProvider("openrouter")).toBe(true)
    expect(requiresHermes(null)).toBe(false)
    expect(requiresHermes("openrouter")).toBe(false)
  })

  it("requires Hermes for every direct (non-OpenRouter) provider", () => {
    for (const id of ["openai", "nvidia", "groq", "deepseek", "custom"] as const) {
      expect(isOpenRouterProvider(id)).toBe(false)
      expect(requiresHermes(id)).toBe(true)
    }
  })
})

describe("resolveByoBaseUrl", () => {
  it("returns the catalog base URL for a named provider", () => {
    expect(resolveByoBaseUrl("openrouter")).toBe(OPENROUTER_BASE_URL)
    expect(resolveByoBaseUrl("openai")).toBe("https://api.openai.com/v1")
    expect(resolveByoBaseUrl("groq")).toBe("https://api.groq.com/openai/v1")
  })

  it("defaults null/unknown ids to the OpenRouter base URL", () => {
    expect(resolveByoBaseUrl(null)).toBe(OPENROUTER_BASE_URL)
    expect(resolveByoBaseUrl("bogus")).toBe(OPENROUTER_BASE_URL)
  })

  it("uses the user-supplied URL for a custom provider, ignoring it otherwise", () => {
    expect(resolveByoBaseUrl("custom", "https://x.example/v1")).toBe("https://x.example/v1")
    expect(resolveByoBaseUrl("custom", "  ")).toBeNull()
    expect(resolveByoBaseUrl("custom")).toBeNull()
    // A named provider ignores any stray custom URL.
    expect(resolveByoBaseUrl("openai", "https://x.example/v1")).toBe("https://api.openai.com/v1")
  })
})
