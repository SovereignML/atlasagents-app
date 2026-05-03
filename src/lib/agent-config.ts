import { z } from "zod"

export const ToneSchema = z.enum(["formal", "sales", "technical", "friendly"])
export const InterfaceKindSchema = z.enum(["web", "telegram", "discord", "slack", "api"])
export const DeploymentTargetSchema = z.enum(["vps", "shared", "serverless"])
export const KnowledgeSourceSchema = z.enum(["none", "url", "file"])
export const BudgetTierSchema = z.enum(["low", "mid", "high"])

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
})

export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type Tone = z.infer<typeof ToneSchema>
export type InterfaceKind = z.infer<typeof InterfaceKindSchema>
export type DeploymentTarget = z.infer<typeof DeploymentTargetSchema>
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>
export type BudgetTier = z.infer<typeof BudgetTierSchema>

/**
 * Normalize: when deployment_target is "shared" or "serverless", infra-shaped
 * inputs (region/server/storage) are irrelevant and are stripped upstream.
 * This function exists to centralize that rule + preserve a single canonical
 * AgentConfig downstream.
 */
export function normalizeAgentConfig(cfg: AgentConfig): AgentConfig {
  if (cfg.deployment_target !== "vps") {
    // No-op on AgentConfig today — VPS-only fields live on the Instance row,
    // not the AgentConfig. Kept as a hook for future shape changes.
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
