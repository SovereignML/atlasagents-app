import { z } from "zod"

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

// Mirrors the request body accepted by POST /api/deploy. `agentConfig` stays
// loosely typed here — its full shape is validated downstream by
// parseAgentConfig (src/lib/agent-config.ts).
export const deploySchema = z.object({
  name: z.string().min(1, "Agent name is required").max(60),
  planSlug: z.string().min(1).default("builder"),
  regionSlug: z.string().min(1).optional(),
  billingInterval: z.enum(["month", "year"]).default("month"),
  rootPassword: z.string().min(8).max(128).optional(),
  sshPublicKey: z.string().optional(),
  agentConfig: z.unknown().optional(),
})

// Agent observability events POSTed to /api/instances/<id>/events. The agent
// (or its forwarder/poller) supplies a stable `id` per event so retries dedupe
// on the AgentEvent primary key — see the ingest route. `detail` is free-form.
export const agentEventSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(["run.started", "run.finished", "tool.called", "message", "error", "heartbeat"]),
  occurredAt: z.string().max(40).optional(),
  runId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
  model: z.string().max(200).optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  status: z.enum(["ok", "error"]).optional(),
  detail: z.unknown().optional(),
})

export const agentEventsBatchSchema = z.object({
  events: z.array(agentEventSchema).min(1).max(500),
})

// Create/update an alert rule. instanceId omitted = fleet-wide (all team agents).
export const alertRuleSchema = z.object({
  instanceId: z.string().min(1).optional(),
  metric: z.enum(["down", "latency_ms", "uptime_ratio", "cost_usd_period", "error_rate"]),
  comparator: z.enum(["gt", "lt"]),
  threshold: z.number().finite(),
  windowMinutes: z.number().int().min(1).max(10080).default(60),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  enabled: z.boolean().default(true),
})

export const userUpdateSchema = z.object({
  action: z.enum(["role", "ban", "unban"]),
  role: z.enum(["user", "admin"]).optional(),
  bannedReason: z.string().max(500).optional(),
})

export const supportTicketSchema = z.object({
  subject: z.string().min(3, "Subject must be at least 3 characters").max(150),
  message: z.string().min(10, "Please describe your issue in at least 10 characters").max(5000),
  category: z.enum(["general", "billing", "technical", "account"]).default("general"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
})

export const supportReplySchema = z.object({
  content: z.string().min(1, "Reply can't be empty").max(5000),
})

// Customers may only resolve or reopen their own ticket; admins drive the
// in_progress/pending states from Chatwoot.
export const supportStatusSchema = z.object({
  status: z.enum(["resolved", "open"]),
})

export const deletionRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
})

export const deletionDecisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "deny"]),
  note: z.string().max(1000).optional(),
})

export const providerUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    // null = unpin; a region id pins this provider for that region.
    pinnedRegionId: z.string().min(1).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" })

export const providerBillingSchema = z
  .object({
    monthlyCreditsUsd: z.number().min(0).optional(),
    softLimitUsd: z.number().min(0).nullable().optional(),
    hardLimitUsd: z.number().min(0).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" })

export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>
export type ProviderBillingInput = z.infer<typeof providerBillingSchema>

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type DeployInput = z.infer<typeof deploySchema>
export type SupportTicketInput = z.infer<typeof supportTicketSchema>
export type SupportReplyInput = z.infer<typeof supportReplySchema>
export type DeletionRequestInput = z.infer<typeof deletionRequestSchema>
export type DeletionDecisionInput = z.infer<typeof deletionDecisionSchema>
