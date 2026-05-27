import type { BudgetTier } from "@/lib/agent-config"

export type ModelRoute = {
  provider: "openrouter"
  model: string
  fallback: string
  apiKeyEnv: "OPENROUTER_API_KEY"
  fallbackProvider?: {
    baseUrl: string
    apiKeyEnv: string
    model: string
  }
}

/**
 * Per-tier model routing. Primary model for all tiers is
 * google/gemma-4-31b-it:free via OpenRouter. Mid tier uses NVIDIA's
 * DeepSeek-V4-Pro as a secondary fallback provider with its own base URL
 * and API key.
 */
export function routeModel(tier: BudgetTier): ModelRoute {
  switch (tier) {
    case "low":
      return {
        provider: "openrouter",
        model: "google/gemma-4-31b-it:free",
        fallback: "google/gemini-2.0-flash:free",
        apiKeyEnv: "OPENROUTER_API_KEY",
      }
    case "mid":
      return {
        provider: "openrouter",
        model: "google/gemma-4-31b-it:free",
        fallback: "google/gemini-2.0-flash:free",
        apiKeyEnv: "OPENROUTER_API_KEY",
        fallbackProvider: {
          baseUrl: "https://integrate.api.nvidia.com/v1",
          apiKeyEnv: "NVIDIA_API_KEY",
          model: "deepseek-v4-pro",
        },
      }
    case "high":
      return {
        provider: "openrouter",
        model: "google/gemma-4-31b-it:free",
        fallback: "google/gemini-2.0-flash:free",
        apiKeyEnv: "OPENROUTER_API_KEY",
      }
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
 * TODO(openrouter): replace these with the chosen ≥64k OpenRouter slugs per tier — the same
 * place the per-key credit limits are maintained. The default below is a conservative,
 * broadly-available ≥64k placeholder so deploys aren't broken-by-default; swap as needed.
 */
const HERMES_MODELS: Record<BudgetTier, string> = {
  low: "anthropic/claude-3.5-sonnet", // 200k ctx — PLACEHOLDER, replace
  mid: "anthropic/claude-3.5-sonnet", // 200k ctx — PLACEHOLDER, replace
  high: "anthropic/claude-3.5-sonnet", // 200k ctx — PLACEHOLDER, replace
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
 * `hermes-gateway` crash loop.
 */
const OPENROUTER_SLUG_RE = /^~?[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/

export function isValidOpenRouterSlug(slug: string): boolean {
  return OPENROUTER_SLUG_RE.test(slug.trim())
}
