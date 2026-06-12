import type { BudgetTier } from "@/lib/agent-config"

/** Selectable LLM providers. OpenRouter is the default; NVIDIA is the fallback. */
export type LlmProvider = "openrouter" | "nvidia"

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
/** OpenAI-compatible base URL for NVIDIA's hosted model API (build.nvidia.com). */
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

export type ModelRoute = {
  provider: LlmProvider
  /** Primary model slug. */
  model: string
  /** Same-provider fallback model slug. */
  fallback: string
  /** OpenAI-compatible base URL the primary/fallback models are served from. */
  baseUrl: string
  /** Env var name holding the API key for `baseUrl`. */
  apiKeyEnv: string
}

/* ------------------------------------------------------------------ */
/* NVIDIA fallback provider (build.nvidia.com)                          */
/* ------------------------------------------------------------------ */

/**
 * Which NVIDIA API key a model is paired with. Both keys can reach the full
 * catalog; using two just spreads load across two free-tier credit pools.
 */
export type NvidiaKeySlot = "primary" | "secondary"

export type NvidiaFallbackModel = {
  /** Stable id used by the admin Models panel UI. */
  id: string
  label: string
  /** NVIDIA model slug, e.g. `mistralai/mistral-medium-3.5-128b`. */
  model: string
  keySlot: NvidiaKeySlot
}

/** The curated NVIDIA fallback models surfaced in the admin Models panel. */
export const NVIDIA_FALLBACK_MODELS: NvidiaFallbackModel[] = [
  {
    id: "mistral-medium-3.5",
    label: "Mistral Medium 3.5 (128B)",
    model: "mistralai/mistral-medium-3.5-128b",
    keySlot: "primary",
  },
  {
    id: "glm-5.1",
    label: "GLM 5.1",
    model: "z-ai/glm-5.1",
    keySlot: "secondary",
  },
]

const NVIDIA_PRIMARY_MODEL = NVIDIA_FALLBACK_MODELS[0].model // mistral → primary key
const NVIDIA_SECONDARY_MODEL = NVIDIA_FALLBACK_MODELS[1].model // glm → secondary key

/**
 * Resolve the NVIDIA API key for a slot. Falls back to the legacy single
 * `NVIDIA_API_KEY` when a slot-specific var is unset (back-compat). Returns ""
 * when nothing is configured so callers surface a clear auth error.
 */
export function nvidiaKeyForSlot(slot: NvidiaKeySlot): string {
  const slotKey =
    slot === "primary"
      ? process.env.NVIDIA_API_KEY_PRIMARY
      : process.env.NVIDIA_API_KEY_SECONDARY
  return (slotKey || process.env.NVIDIA_API_KEY || "").trim()
}

/**
 * Resolve which provider a bot should run against: the per-instance override,
 * then the platform default (`LLM_DEFAULT_PROVIDER`), then OpenRouter. Set
 * `LLM_DEFAULT_PROVIDER=nvidia` (or an instance's `llmProvider`) to run with
 * zero OpenRouter dependency — the "works without OpenRouter credits" switch.
 */
export function resolveLlmProvider(
  instance?: { llmProvider?: string | null } | null,
): LlmProvider {
  const raw = (
    instance?.llmProvider ||
    process.env.LLM_DEFAULT_PROVIDER ||
    "openrouter"
  )
    .trim()
    .toLowerCase()
  return raw === "nvidia" ? "nvidia" : "openrouter"
}

/**
 * Per-tier model routing.
 *
 * - `provider="openrouter"` (default): OpenRouter primary with a same-provider
 *   fallback. OpenRouter is the only LLM key shipped to bots — there is no
 *   cross-provider fallback.
 * - `provider="nvidia"`: dormant NVIDIA-primary route, retained for the
 *   explicit `LLM_DEFAULT_PROVIDER=nvidia` switch. Not used by default.
 *
 * `tier` is currently uniform but kept in the signature so per-tier models can
 * diverge later without touching callers.
 *
 * Slugs verified live against https://openrouter.ai/api/v1/models on
 * 2026-06-12 (the previous `moonshotai/kimi-k2.6:free` variant was delisted).
 */
export function routeModel(
  tier: BudgetTier,
  provider: LlmProvider = "openrouter",
): ModelRoute {
  if (provider === "nvidia") {
    return {
      provider: "nvidia",
      model: NVIDIA_PRIMARY_MODEL,
      fallback: NVIDIA_SECONDARY_MODEL,
      baseUrl: NVIDIA_BASE_URL,
      apiKeyEnv: "NVIDIA_API_KEY_PRIMARY",
    }
  }
  return {
    provider: "openrouter",
    model: "minimax/minimax-m2.5",
    fallback: "moonshotai/kimi-k2.6",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  }
}

/* ------------------------------------------------------------------ */
/* OpenRouter account allowlist                                        */
/* ------------------------------------------------------------------ */

export type AllowedModelKind = "chat" | "image" | "moderation"

export type AllowedOpenRouterModel = {
  /** Live OpenRouter slug (verified against /api/v1/models on 2026-06-12). */
  slug: string
  label: string
  /** Only `chat` models are usable as agent brains for OpenClaw/Hermes. */
  kind: AllowedModelKind
}

/**
 * The models enabled on the platform's OpenRouter account (account-level
 * provider/model allowlist). Per-instance runtime keys are minted under this
 * account, so bots can ONLY reach these — any other slug fails at request
 * time even though it exists in the public catalog. Keep this in sync with
 * the OpenRouter account settings whenever the allowlist changes there.
 */
export const ALLOWED_OPENROUTER_MODELS: AllowedOpenRouterModel[] = [
  { slug: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", kind: "chat" },
  { slug: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", kind: "chat" },
  { slug: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", kind: "chat" },
  { slug: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", kind: "chat" },
  { slug: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", kind: "chat" },
  { slug: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B A4B (free)", kind: "chat" },
  { slug: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", kind: "chat" },
  { slug: "minimax/minimax-m2.5", label: "MiniMax M2.5", kind: "chat" },
  { slug: "mistralai/mistral-medium-3-5", label: "Mistral Medium 3.5", kind: "chat" },
  { slug: "mistralai/mistral-small-2603", label: "Mistral Small 4", kind: "chat" },
  { slug: "moonshotai/kimi-k2.6", label: "Kimi K2.6", kind: "chat" },
  { slug: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", label: "Nemotron 3 Nano Omni (free)", kind: "chat" },
  { slug: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra (free)", kind: "chat" },
  { slug: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", kind: "chat" },
  { slug: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano", kind: "chat" },
  { slug: "openai/gpt-5.5", label: "GPT-5.5", kind: "chat" },
  { slug: "qwen/qwen3.6-flash", label: "Qwen3.6 Flash", kind: "chat" },
  { slug: "z-ai/glm-5.1", label: "GLM 5.1", kind: "chat" },
  { slug: "google/gemini-3.1-flash-image-preview", label: "Nano Banana 2 (Gemini 3.1 Flash Image)", kind: "image" },
  { slug: "openai/gpt-5.4-image-2", label: "GPT-5.4 Image 2", kind: "image" },
  { slug: "nvidia/nemotron-3.5-content-safety:free", label: "Nemotron 3.5 Content Safety (free)", kind: "moderation" },
]

const ALLOWED_SLUGS = new Set(ALLOWED_OPENROUTER_MODELS.map((m) => m.slug))

export function isAllowedOpenRouterModel(slug: string): boolean {
  return ALLOWED_SLUGS.has(slug.trim())
}

/* ------------------------------------------------------------------ */
/* Hermes model selection                                              */
/* ------------------------------------------------------------------ */

/**
 * Hermes-specific per-tier models, kept SEPARATE from `routeModel` (which also feeds
 * OpenClaw). Hermes **rejects any model with <64k context at startup**, so the small
 * `:free` slugs above are unusable here. Slugs must be live OpenRouter `<author>/<slug>`
 * with ≥64k context.
 *
 * Cost-efficient ladder (slugs + pricing verified live against
 * https://openrouter.ai/api/v1/models on 2026-06-12). `low` matches the
 * `routeModel` OpenRouter primary so platform behavior stays consistent.
 * Every tier model must be in ALLOWED_OPENROUTER_MODELS — the account-level
 * allowlist rejects anything else at request time.
 */
const HERMES_MODELS: Record<BudgetTier, string> = {
  low: "minimax/minimax-m2.5", // 204k ctx — $0.15/$0.90 per M
  mid: "deepseek/deepseek-v4-pro", // 1048k ctx — $0.43/$0.87 per M
  high: "moonshotai/kimi-k2.6", // 262k ctx — $0.68/$3.41 per M
}

/**
 * Resolve the OpenRouter model slug Hermes should pin as its default for a tier.
 * `HERMES_MODEL` env overrides everything (useful for testing / pinning a single model).
 */
export function hermesModel(tier: BudgetTier): string {
  return process.env.HERMES_MODEL?.trim() || HERMES_MODELS[tier]
}

/**
 * OpenRouter slug shape: `<author>/<slug>`, with an optional `~` (latest) prefix and an
 * optional `:variant` suffix (e.g. `~anthropic/claude-sonnet-latest`, `deepseek/deepseek-chat`,
 * `google/gemini-flash-1.5:free`). Used to fail a Hermes provision *before* `systemctl start`
 * when the model is missing/malformed — a clear provisioning error instead of a silent
 * `hermes-gateway` crash loop. NVIDIA slugs (e.g. `mistralai/mistral-medium-3.5-128b`)
 * satisfy the same shape.
 */
const OPENROUTER_SLUG_RE = /^~?[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/

export function isValidOpenRouterSlug(slug: string): boolean {
  return OPENROUTER_SLUG_RE.test(slug.trim())
}
