// Bring-Your-Own-Key (BYOS own_key) LLM provider catalog — the static source of
// truth for the "where is your key from?" selector in the BYOS connect flow and
// for resolving the OpenAI-compatible base URL each key authenticates against.
//
// This is intentionally SEPARATE from `LlmProvider` in src/lib/model-router.ts:
// that union ("openrouter" | "nvidia") drives platform-managed routing, NVIDIA
// key-slotting, and the OpenRouter account allowlist. BYO providers are a
// user-facing concept (the customer's own credentials), so they live here and
// never widen the platform union.
//
// Every provider here is OpenAI-compatible (exposes `<baseUrl>/chat/completions`
// and `<baseUrl>/models`). OpenRouter is the only one both runtimes support;
// every other (direct) provider requires the Hermes runtime, because OpenClaw's
// npm package hardwires its built-in `openrouter` provider (see
// src/lib/runtimes/shared.ts buildEnv). `requiresHermes()` is the enforcement
// predicate used at the API layer and in the connect UI.

import { OPENROUTER_BASE_URL, NVIDIA_BASE_URL } from "@/lib/model-router"

export type ByoProviderId =
  | "openrouter"
  | "openai"
  | "nvidia"
  | "groq"
  | "deepseek"
  | "custom"

export type ByoProviderDef = {
  id: ByoProviderId
  label: string
  /** OpenAI-compatible base URL. `null` ONLY for "custom" (user-entered). */
  baseUrl: string | null
  /** Placeholder shown in the key input, e.g. "sk-or-...". */
  apiKeyPlaceholder: string
  /** Optional soft hint for the expected key prefix (not hard-validated). */
  keyPrefixHint?: string
  /** Always true today — documents the request contract the runtime relies on. */
  openaiCompatible: boolean
  /** True only for "openrouter" — the one provider both runtimes support. */
  openRouter: boolean
}

export const BYO_LLM_PROVIDERS: readonly ByoProviderDef[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyPlaceholder: "sk-or-...",
    keyPrefixHint: "sk-or-",
    openaiCompatible: true,
    openRouter: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyPlaceholder: "sk-...",
    keyPrefixHint: "sk-",
    openaiCompatible: true,
    openRouter: false,
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    baseUrl: NVIDIA_BASE_URL,
    apiKeyPlaceholder: "nvapi-...",
    keyPrefixHint: "nvapi-",
    openaiCompatible: true,
    openRouter: false,
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyPlaceholder: "gsk_...",
    keyPrefixHint: "gsk_",
    openaiCompatible: true,
    openRouter: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyPlaceholder: "sk-...",
    keyPrefixHint: "sk-",
    openaiCompatible: true,
    openRouter: false,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: null,
    apiKeyPlaceholder: "your-api-key",
    openaiCompatible: true,
    openRouter: false,
  },
] as const

const BY_ID: Map<string, ByoProviderDef> = new Map(
  BYO_LLM_PROVIDERS.map((p) => [p.id, p]),
)

/** Look up a provider definition by id, or null if the id is unknown. */
export function getByoProvider(id: string | null | undefined): ByoProviderDef | null {
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/** True when the id is a valid catalog provider id. */
export function isByoProviderId(id: string | null | undefined): id is ByoProviderId {
  return !!id && BY_ID.has(id)
}

/**
 * The OpenAI-compatible base URL a key authenticates against: the catalog URL
 * for a named provider, or the user's `customBaseUrl` for "custom". NULL id ⇒
 * treated as "openrouter" (back-compat with legacy own_key rows that predate the
 * provider column). Returns null only when a "custom" provider has no base URL.
 */
export function resolveByoBaseUrl(
  id: string | null | undefined,
  customBaseUrl?: string | null,
): string | null {
  const provider = getByoProvider(id) ?? getByoProvider("openrouter")!
  if (provider.id === "custom") return customBaseUrl?.trim() || null
  return provider.baseUrl
}

/** True when the id is (or defaults to) OpenRouter. */
export function isOpenRouterProvider(id: string | null | undefined): boolean {
  // NULL/unknown ⇒ historical OpenRouter assumption.
  return !id || id === "openrouter"
}

/**
 * True when a provider requires the Hermes runtime (i.e. any non-OpenRouter
 * direct provider). OpenClaw only supports OpenRouter.
 */
export function requiresHermes(id: string | null | undefined): boolean {
  return !isOpenRouterProvider(id)
}
