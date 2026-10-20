import { z } from "zod"
import { RUNTIME_IDS } from "@/lib/runtimes/ids"
import { runtimeCaps } from "@/lib/runtimes/labels"

export const ToneSchema = z.enum(["formal", "sales", "technical", "friendly"])
export const InterfaceKindSchema = z.enum(["web", "telegram", "discord", "slack", "api"])
export const DeploymentTargetSchema = z.enum(["vps", "shared", "serverless", "byos"])
export const KnowledgeSourceSchema = z.enum(["none", "url", "file"])
export const BudgetTierSchema = z.enum(["low", "mid", "high"])
export const RuntimeSchema = z.enum(RUNTIME_IDS)

/** Shape posted by the deploy wizard under `body.agentConfig`. */
export const AgentConfigSchema = z.object({
  use_case: z.string().min(1),
  target_user: z.string().default(""),
  core_actions: z.array(z.string()).default([]),
  tone: ToneSchema.default("friendly"),
  interface: InterfaceKindSchema.default("web"),
  deployment_target: DeploymentTargetSchema.default("shared"),
  knowledge_source: KnowledgeSourceSchema.default("none"),
  budget_tier: BudgetTierSchema.default("mid"),
  // Freeform, user-authored instructions appended verbatim to the persona at
  // the highest priority. Lets an operator shape an agent beyond its role
  // defaults without us building a full persona-authoring studio.
  custom_instructions: z.string().default(""),
  // VPS-only: which agent runtime engine powers the bot.
  runtime: RuntimeSchema.default("openclaw"),
  // Provision the chat UI sidecar (engines that ship one).
  webui_enabled: z.boolean().default(false),
})

export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type Tone = z.infer<typeof ToneSchema>
export type InterfaceKind = z.infer<typeof InterfaceKindSchema>
export type DeploymentTarget = z.infer<typeof DeploymentTargetSchema>
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>
export type BudgetTier = z.infer<typeof BudgetTierSchema>
export type Runtime = z.infer<typeof RuntimeSchema>

/**
 * Normalize: when deployment_target is "shared" or "serverless", infra-shaped
 * inputs (region/server/storage) are irrelevant and are stripped upstream.
 * This function exists to centralize that rule + preserve a single canonical
 * AgentConfig downstream.
 */
export function normalizeAgentConfig(cfg: AgentConfig): AgentConfig {
  // Runtime engine is meaningful only where we install a runtime over SSH:
  // the managed VPS path and the customer's own server (BYOS). Other targets
  // always run the default runtime. Other infra fields live on the Instance row.
  if (cfg.deployment_target !== "vps" && cfg.deployment_target !== "byos") {
    return { ...cfg, runtime: "openclaw", webui_enabled: false }
  }
  // The chat UI sidecar only exists for engines that ship one.
  if (!runtimeCaps(cfg.runtime).hasSidecar) {
    return { ...cfg, webui_enabled: false }
  }
  return cfg
}

/** Safe parse helper used in API routes. Returns either parsed cfg or null + error. */
export function parseAgentConfig(input: unknown):
  | { ok: true; data: AgentConfig }
  | { ok: false; error: string } {
  const r = AgentConfigSchema.safeParse(input)
  if (!r.success) {
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }
  }
  return { ok: true, data: normalizeAgentConfig(r.data) }
}
