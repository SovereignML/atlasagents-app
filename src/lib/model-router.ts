import type { BudgetTier } from "@/lib/agent-config"
import type { RuntimeId } from "@/lib/runtimes/types"

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

/**
 * The curated NVIDIA fallback models. Checked against
 * https://integrate.api.nvidia.com/v1/models on 2026-10-20, which no longer
 * lists the earlier Mistral Medium 3.5 and GLM 5.1.
 */
export const NVIDIA_FALLBACK_MODELS: NvidiaFallbackModel[] = [
  {
    id: "glm-5.3",
    label: "GLM 5.3",
    model: "z-ai/glm-5.3",
    keySlot: "primary",
  },
  {
    id: "nemotron-3.5-super-vl",
    label: "Nemotron 3.5 Super VL",
    model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    keySlot: "secondary",
  },
]

const NVIDIA_PRIMARY_MODEL = NVIDIA_FALLBACK_MODELS[0].model // glm → primary key
const NVIDIA_SECONDARY_MODEL = NVIDIA_FALLBACK_MODELS[1].model // nemotron → secondary key

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
 * 2026-10-20.
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
    model: "minimax/minimax-m3",
    fallback: "z-ai/glm-5.3",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  }
}

/* ------------------------------------------------------------------ */
/* OpenRouter account allowlist                                        */
/* ------------------------------------------------------------------ */

export type AllowedModelKind = "chat" | "image" | "moderation"

/**
 * At-a-glance positioning shown in the per-instance model picker so users don't
 * need to read pricing/benchmark tables:
 *   cheap      — best value / lowest cost
 *   quality    — best output quality (premium)
 *   allrounder — balanced default-grade pick
 * Curated, not derived — tweak freely as the lineup changes.
 */
export type ModelTag = "cheap" | "quality" | "allrounder"

export type AllowedOpenRouterModel = {
  /** Live OpenRouter slug (verified against /api/v1/models on 2026-06-12). */
  slug: string
  label: string
  /** Only `chat` models are usable as agent brains for OpenClaw/Hermes. */
  kind: AllowedModelKind
  /** Picker positioning hint (chat models only). */
  tag?: ModelTag
}

/**
 * The models enabled on the platform's OpenRouter account (account-level
 * provider/model allowlist). Per-instance runtime keys are minted under this
 * account, so bots can ONLY reach these — any other slug fails at request
 * time even though it exists in the public catalog. Keep this in sync with
 * the OpenRouter account settings whenever the allowlist changes there.
 */
export const ALLOWED_OPENROUTER_MODELS: AllowedOpenRouterModel[] = [
  // The newest generation from each provider, verified live against
  // https://openrouter.ai/api/v1/models on 2026-10-20. Every chat model has at
  // least Hermes' 64k context.
  { slug: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1", kind: "chat", tag: "quality" },
  { slug: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", kind: "chat", tag: "quality" },
  { slug: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", kind: "chat", tag: "allrounder" },
  { slug: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", kind: "chat", tag: "cheap" },
  { slug: "openai/gpt-6-astra", label: "GPT-6 Astra", kind: "chat", tag: "quality" },
  { slug: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", kind: "chat", tag: "allrounder" },
  { slug: "openai/gpt-6-luna", label: "GPT-6 Luna", kind: "chat", tag: "cheap" },
  { slug: "google/gemini-4-argon", label: "Gemini 4 Argon", kind: "chat", tag: "quality" },
  { slug: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", kind: "chat", tag: "allrounder" },
  { slug: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", kind: "chat", tag: "cheap" },
  { slug: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", kind: "chat", tag: "cheap" },
  { slug: "x-ai/grok-4.7", label: "Grok 4.7", kind: "chat", tag: "quality" },
  { slug: "x-ai/grok-build-0.1", label: "Grok Build 0.1", kind: "chat", tag: "allrounder" },
  { slug: "deepseek/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", kind: "chat", tag: "allrounder" },
  { slug: "deepseek/deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash", kind: "chat", tag: "cheap" },
  { slug: "moonshotai/kimi-k3", label: "Kimi K3", kind: "chat", tag: "quality" },
  { slug: "z-ai/glm-5.3", label: "GLM 5.3", kind: "chat", tag: "allrounder" },
  { slug: "qwen/qwen3.8-max-prime", label: "Qwen3.8 Max Prime", kind: "chat", tag: "quality" },
  { slug: "qwen/qwen3.8-flash", label: "Qwen3.8 Flash", kind: "chat", tag: "cheap" },
  { slug: "minimax/minimax-m3", label: "MiniMax M3", kind: "chat", tag: "allrounder" },
  { slug: "minimax/minimax-m3.1-flash:free", label: "MiniMax M3.1 Flash (free)", kind: "chat", tag: "cheap" },
  { slug: "mistralai/mistral-large-4-0", label: "Mistral Large 4", kind: "chat", tag: "allrounder" },
  { slug: "mistralai/mistral-small-2603", label: "Mistral Small 4", kind: "chat", tag: "cheap" },
  { slug: "nvidia/nemotron-3.5-super-vl:free", label: "Nemotron 3.5 Super VL (free)", kind: "chat", tag: "cheap" },
  { slug: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning (free)", kind: "chat", tag: "cheap" },
  { slug: "google/gemini-nano-banana-2.1", label: "Nano Banana 2.1", kind: "image" },
  { slug: "openai/gpt-5.4-image-2", label: "GPT-5.4 Image 2", kind: "image" },
  { slug: "nvidia/nemotron-3.5-content-safety:free", label: "Nemotron 3.5 Content Safety (free)", kind: "moderation" },
]

/** Curated picker positioning by slug (see {@link ModelTag}). */
const MODEL_TAG_BY_SLUG: Map<string, ModelTag> = new Map(
  ALLOWED_OPENROUTER_MODELS.flatMap((m) => (m.tag ? [[m.slug, m.tag] as const] : [])),
)

/** The picker positioning tag for a model slug, or null if untagged. */
export function modelTag(slug: string): ModelTag | null {
  return MODEL_TAG_BY_SLUG.get(slug) ?? null
}

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
 * https://openrouter.ai/api/v1/models on 2026-10-20). `low` matches the
 * `routeModel` OpenRouter primary so platform behavior stays consistent.
 * Every tier model must be in ALLOWED_OPENROUTER_MODELS — the account-level
 * allowlist rejects anything else at request time.
 */
const HERMES_MODELS: Record<BudgetTier, string> = {
  low: "minimax/minimax-m3", // 1048k ctx — $0.30/$1.20 per M
  mid: "deepseek/deepseek-v4-pro-0813", // 1048k ctx — $0.66/$1.98 per M
  high: "moonshotai/kimi-k3", // 1048k ctx — $0.24/$11.94 per M
}

/**
 * Resolve the OpenRouter model slug Hermes should pin as its default for a tier.
 * `HERMES_MODEL` env overrides everything (useful for testing / pinning a single model).
 */
export function hermesModel(tier: BudgetTier): string {
  return process.env.HERMES_MODEL?.trim() || HERMES_MODELS[tier]
}

/**
 * Claude Code speaks the Anthropic Messages API (through OpenRouter's
 * Anthropic-compatible endpoint), so its ladder is Claude models only.
 * Slugs + pricing verified live against https://openrouter.ai/api/v1/models on
 * 2026-10-11. `CLAUDE_CODE_MODEL` env overrides every tier.
 */
export const CLAUDE_CODE_MODELS: Record<BudgetTier, string> = {
  low: "anthropic/claude-haiku-5.5", // 1M ctx — $0.10/$0.50 per M
  mid: "anthropic/claude-sonnet-5.5", // 1M ctx — $2/$10 per M
  high: "anthropic/claude-opus-5.5", // 1M ctx — $4/$20 per M
}

export function claudeCodeModel(tier: BudgetTier): string {
  return process.env.CLAUDE_CODE_MODEL?.trim() || CLAUDE_CODE_MODELS[tier]
}

/**
 * Codex is built around OpenAI's models; the ladder is the GPT-6 line, from
 * Luna to Astra. Verified live on 2026-10-20. `CODEX_MODEL` env overrides
 * every tier.
 */
export const CODEX_MODELS: Record<BudgetTier, string> = {
  low: "openai/gpt-6-luna", // 1M ctx — $0.10/$0.50 per M
  mid: "openai/gpt-6.1-sol", // 1M ctx — $2/$10 per M
  high: "openai/gpt-6-astra", // 1M ctx — $10/$50 per M
}

export function codexModel(tier: BudgetTier): string {
  return process.env.CODEX_MODEL?.trim() || CODEX_MODELS[tier]
}

/**
 * Gemini CLI drives Google's models only (the gateway translates its Gemini
 * API calls to OpenRouter). Verified live on 2026-10-20. `GEMINI_CLI_MODEL`
 * env overrides every tier.
 */
export const GEMINI_CLI_MODELS: Record<BudgetTier, string> = {
  low: "google/gemini-3.5-flash-lite", // 1M ctx — $0.30/$2.50 per M
  mid: "google/gemini-3.8-flash", // 1M ctx — $0.83/$4.13 per M
  high: "google/gemini-4-argon", // 1M ctx — $2/$10 per M
}

export function geminiCliModel(tier: BudgetTier): string {
  return process.env.GEMINI_CLI_MODEL?.trim() || GEMINI_CLI_MODELS[tier]
}

/**
 * Grok drives xAI's models only. Verified live on 2026-10-20. `GROK_MODEL`
 * env overrides every tier.
 */
export const GROK_MODELS: Record<BudgetTier, string> = {
  low: "x-ai/grok-build-0.1", // 256k ctx — $1/$2 per M
  mid: "x-ai/grok-4.7", // 500k ctx — $2/$6 per M
  high: "x-ai/grok-4.7",
}

export function grokModel(tier: BudgetTier): string {
  return process.env.GROK_MODEL?.trim() || GROK_MODELS[tier]
}

/**
 * Runtimes that pin their own per-tier default instead of `routeModel(tier)`
 * (whose `:free` fallbacks Hermes cannot run, and whose models the CLI engines
 * cannot drive). Absent ⇒ the routed model.
 */
const RUNTIME_MODEL_LADDERS: Partial<Record<RuntimeId, (tier: BudgetTier) => string>> = {
  hermes: hermesModel,
  "claude-code": claudeCodeModel,
  codex: codexModel,
  // OpenCode and Pi drive any OpenRouter model; Hermes' ladder is the same
  // need (paid, tool-capable, long context), without HERMES_MODEL's override.
  opencode: (tier) => HERMES_MODELS[tier],
  pi: (tier) => HERMES_MODELS[tier],
  "gemini-cli": geminiCliModel,
  grok: grokModel,
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

/**
 * Resolve the OpenRouter model slug an instance should actually run, applying the
 * per-instance override (`instances.modelSlug`) when present and falling back to the
 * tier default otherwise. This is the single place provisioning consults so both the
 * first-provision and reprovision paths stay consistent.
 *
 * - The override only applies to OpenRouter-primary bots — NVIDIA-primary bots use a
 *   different account/allowlist, so they always take the routed NVIDIA model.
 * - With no override: Hermes pins its own ≥64k slug (`hermesModel`), every other
 *   runtime keeps the routed model (`routedModel`, i.e. `routeModel(tier).model`).
 *
 * The override is validated against the runtime's selectable allowlist at the API
 * layer (see selectableModelsForRuntime); `isValidOpenRouterSlug` still guards the
 * final value before provisioning.
 */
export function effectiveModel(args: {
  runtimeId: string
  llmProvider: LlmProvider
  tier: BudgetTier
  modelSlug?: string | null
  /** The routed default for non-Hermes runtimes — `routeModel(tier, provider).model`. */
  routedModel: string
}): string {
  const override = args.modelSlug?.trim()
  if (args.llmProvider === "openrouter" && override) return override
  const ownLadder = Object.hasOwn(RUNTIME_MODEL_LADDERS, args.runtimeId)
    ? RUNTIME_MODEL_LADDERS[args.runtimeId as RuntimeId]
    : undefined
  return ownLadder && args.llmProvider === "openrouter"
    ? ownLadder(args.tier)
    : args.routedModel
}
