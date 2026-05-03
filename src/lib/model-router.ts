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
