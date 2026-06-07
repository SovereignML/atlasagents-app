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
  /**
   * Optional cross-provider fallback. Best-effort: only honored if the runtime
   * package reads the `*_FALLBACK_BASE_URL` / `*_FALLBACK_MODEL` env contract.
   */
  fallbackProvider?: {
    baseUrl: string
    apiKeyEnv: string
    model: string
  }
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
 * - `provider="openrouter"` (default): primary OpenRouter model with a `:free`
 *   same-provider fallback, plus a best-effort NVIDIA cross-provider fallback on
 *   **every** tier (previously mid-only).
 * - `provider="nvidia"`: deterministic NVIDIA-primary route (no OpenRouter
 *   dependency) — Mistral primary, GLM as the same-provider fallback.
 *
 * `tier` is currently uniform but kept in the signature so per-tier models can
 * diverge later without touching callers.
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
    fallback: "moonshotai/kimi-k2.6:free",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
    fallbackProvider: {
      baseUrl: NVIDIA_BASE_URL,
      apiKeyEnv: "NVIDIA_API_KEY",
      model: NVIDIA_PRIMARY_MODEL,
    },
  }
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
 * Cost-efficient OSS ladder (slugs + pricing verified live against
 * https://openrouter.ai/api/v1/models on 2026-06-07). `low` matches the
 * `routeModel` OpenRouter primary so platform behavior stays consistent.
 */
const HERMES_MODELS: Record<BudgetTier, string> = {
  low: "minimax/minimax-m2.5", // 204k ctx — $0.15/$1.15 per M
  mid: "z-ai/glm-4.7", // 202k ctx — $0.40/$1.75 per M
  high: "moonshotai/kimi-k2.6", // 262k ctx — $0.68/$3.42 per M
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
