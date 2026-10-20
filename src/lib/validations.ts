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
  // Optional: the wizard leaves naming to the server (generateProjectName).
  name: z.string().trim().min(1).max(60).optional(),
  planSlug: z.string().min(1).default("builder"),
  regionSlug: z.string().min(1).optional(),
  billingInterval: z.enum(["month", "year"]).default("month"),
  rootPassword: z.string().min(8).max(128).optional(),
  sshPublicKey: z.string().optional(),
  agentConfig: z.unknown().optional(),
})

// Renaming an agent (PATCH /api/instances/<id>): the display name only.
export const instanceRenameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Use at most 60 characters"),
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
// ── Request bodies read with readJsonBody() (src/lib/request-body.ts) ──
// Every field is typed and bounded. Routes keep their own domain checks
// (catalog lookups, ownership); these only stop malformed or oversized input.

const id = z.string().trim().min(1).max(128)

/** Wallet top-up. MAX_TOPUP_CREDITS bounds one checkout; buy again for more. */
export const MAX_TOPUP_CREDITS = 100_000
export const walletTopupSchema = z.object({
  credits: z
    .number()
    .finite()
    .transform((n) => Math.round(n))
    .pipe(z.number().int().max(MAX_TOPUP_CREDITS, `Maximum top-up is ${MAX_TOPUP_CREDITS.toLocaleString("en-US")} credits per purchase`)),
})

export const byosPlanCheckoutSchema = z.object({
  interval: z.enum(["month", "year"]).optional(),
})

/** Cancel a BYOS plan at the end of its paid period, or undo that. */
export const byosPlanChangeSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
})

export const byosServerConnectSchema = z.object({
  host: z.string().trim().min(1, "A hostname or IP address is required").max(253),
  port: z.number().int().min(1).max(65535).optional(),
  sshUser: z.string().trim().min(1).max(32).regex(/^[a-z_][a-z0-9_.-]*$/i, "Invalid SSH user").optional(),
  label: z.string().trim().max(60).optional(),
  /** The owner agreed to have packages preinstalled (BYOS_PREBAKE_ENABLED only). */
  prebakeConsent: z.boolean().optional(),
})

const secret = z.string().max(512)
const url = z.string().trim().max(2048)
export const byosDeploySchema = z.object({
  // Optional: the install wizard leaves naming to the server.
  name: z.string().trim().min(1).max(60).optional(),
  byosServerId: id,
  llmMode: z.enum(["managed_credits", "own_key"], { message: "Invalid llmMode" }),
  ownApiKey: secret.optional(),
  ownProvider: z.string().max(64).optional(),
  ownBaseUrl: url.optional(),
  ownModel: z.string().max(200).optional(),
  fallbackProvider: z.string().max(64).optional(),
  fallbackApiKey: secret.optional(),
  fallbackBaseUrl: url.optional(),
  agentConfig: z.unknown().optional(),
  /** Billing interval for a new plan, used only when no plan is free and the install goes through Checkout. */
  interval: z.enum(["month", "year"]).optional(),
})

const password = z.string().max(128, "Password must be 128 characters or fewer")
const social = z.string().trim().max(64).nullish()
export const accountUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update-name"),
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  }),
  z.object({
    action: z.literal("update-password"),
    currentPassword: password.optional(),
    newPassword: password.min(6, "New password must be at least 6 characters"),
  }),
  z.object({
    action: z.literal("update-socials"),
    telegramId: social,
    twitterHandle: social,
    discordId: social,
  }),
], { message: "Invalid action" })

export const twoFactorActionSchema = z.object({
  action: z.enum(["setup", "verify-setup", "regenerate-backup-codes", "disable"], {
    message: "Invalid action",
  }),
  code: z.string().max(32).optional(),
  password: password.optional(),
})

const email = z.string().trim().min(1, "Email is required").max(254)
const verificationToken = z.string().min(1, "Missing required fields").max(256)
export const forgotPasswordSchema = z.object({
  email,
  turnstileToken: z.string().max(4096).nullish(),
})
export const resetPasswordSchema = z.object({
  token: verificationToken,
  email,
  password: password.min(6, "Password must be at least 6 characters"),
})
export const verifyEmailSchema = z.object({
  token: verificationToken,
  email,
})

const accessLevel = z.enum(["viewer", "operator", "manager"], { message: "Invalid level" })
export const instanceAccessGrantSchema = z.object({
  userId: z.string().trim().min(1, "Missing userId or invalid level").max(128),
  level: accessLevel,
})
export const instanceAccessUpdateSchema = z.object({ level: accessLevel })

export const agentTypeSchema = z.object({
  agentType: z.string().min(1, "agentType is required").max(64),
})
export const byosKeySlotSchema = z.object({
  slot: z.enum(["primary", "fallback"], { message: 'slot must be "primary" or "fallback"' }),
})
export const cloudflareDomainSchema = z.object({
  zoneId: z.string().trim().min(1, "Missing zoneId").max(64),
  label: z.string().trim().max(253).optional(),
  overwrite: z.boolean().optional(),
})
export const MAX_CUSTOM_INSTRUCTIONS = 4000
export const customInstructionsSchema = z.object({
  customInstructions: z
    .string({ message: "customInstructions must be a string" })
    .trim()
    .max(MAX_CUSTOM_INSTRUCTIONS, `customInstructions must be ${MAX_CUSTOM_INSTRUCTIONS} characters or fewer`),
})
export const instanceDomainSchema = z.object({
  domain: z.string().trim().max(253).nullish(),
  checkOnly: z.boolean().optional(),
})
const filePath = z.string().trim().min(1, "A path is required.").max(4096)
export const fileSaveSchema = z.object({
  path: z.string().trim().min(1, "A file path is required.").max(4096),
  // Byte size is checked in the route (MAX_TEXT_BYTES, 413); this bounds parsing.
  content: z.string().max(4_000_000).optional(),
})
export const fileOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("mkdir"), path: filePath }),
  z.object({
    op: z.literal("rename"),
    path: filePath,
    newPath: z.string().trim().min(1, "A destination path is required.").max(4096),
  }),
], { message: 'op must be "mkdir" or "rename".' })
export const telegramConnectSchema = z.object({
  kind: z.literal("telegram", { message: "Invalid body" }),
  token: z.string().trim().min(1, "Invalid body").max(256),
})
export const knowledgeSourceSchema = z.object({
  type: z.enum(["url", "file"], { message: 'type must be "url" or "file"' }),
  name: z.string().max(500).optional(),
  sourceUrl: z.string().trim().max(2048).optional(),
  // Stored text is truncated to 200 KB in the route; this bounds parsing.
  textContent: z.string().max(2_000_000).optional(),
})
export const instanceModelSchema = z.object({
  modelSlug: z.string({ message: "modelSlug must be a string or null" }).max(200).nullish(),
})
export const caddyRestartSchema = z.object({
  mode: z.enum(["reload", "restart"]).optional(),
})
const catalogIds = (label: string) =>
  z
    .array(z.string().max(64), { message: `${label} must be an array of strings` })
    .max(100, `${label} can list at most 100 entries`)
export const instanceSkillsSchema = z.object({ enabledSkills: catalogIds("enabledSkills") })
export const instanceToolsSchema = z.object({ enabledTools: catalogIds("enabledTools") })

const modelSlug = z.string().trim().min(1, "slug is required").max(200)
const modelKind = z.enum(["chat", "image", "moderation"], { message: "kind must be chat | image | moderation" })
export const adminModelAddSchema = z.union([
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("reset") }),
  z.object({
    action: z.undefined().optional(),
    slug: modelSlug,
    label: z.string().max(200).optional(),
    kind: modelKind.optional(),
    contextLength: z.number().int().min(0).max(100_000_000).nullish(),
  }),
])
export const adminModelEditSchema = z.object({
  slug: modelSlug,
  label: z.string().max(200).optional(),
  kind: modelKind.optional(),
  enabled: z.boolean().optional(),
})
export const adminModelRemoveSchema = z.object({ slug: modelSlug })
export const adminNotificationResolveSchema = z.object({ id: z.string().trim().min(1, "id is required").max(128) })
export const backupRestoreSchema = z.object({
  confirm: z.literal("RESTORE", { message: 'Type "RESTORE" to confirm this destructive action.' }),
})

export const consentSchema = z.object({
  marketing: z.boolean({ message: "`marketing` boolean required" }),
  analytics: z.boolean().optional(),
})
export const domainVerifySchema = z.object({
  domain: z.string().trim().min(1, "domain required").max(253),
})
export const cloudflareConnectSchema = z.object({
  token: z.string().trim().min(1, "Missing API token").max(256),
})
export const alertRuleUpdateSchema = z
  .object({
    enabled: z.boolean(),
    threshold: z.number().finite().min(-1e12).max(1e12),
    windowMinutes: z.number().int().min(1).max(10080),
    cooldownMinutes: z.number().int().min(1).max(10080),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" })
export const notificationReadSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  all: z.boolean().optional(),
})
export const plannerSchema = z.object({
  useCase: z.string({ message: "Missing or invalid 'useCase' field" }).min(1, "Missing or invalid 'useCase' field").max(64),
})
export const sshKeyAddSchema = z.object({
  name: z.string().trim().max(100).optional(),
  publicKey: z.string().trim().min(1, "Invalid SSH public key").max(16_384, "Invalid SSH public key"),
})
export const modelProbeSchema = z.object({
  model: z.string().trim().max(200).optional(),
  prompt: z.string().max(2000).optional(),
})
export const usageIngestSchema = z.object({
  kind: z.enum(["request", "tokens_in", "tokens_out"], { message: "kind and amount are required" }),
  amount: z.number({ message: "kind and amount are required" }).finite().min(0, "amount must be a non-negative finite number"),
  meta: z
    .record(z.string(), z.unknown())
    .refine((m) => JSON.stringify(m).length <= 4096, { message: "meta must be 4 KB or less" })
    .optional(),
  instanceId: z.string().max(128).optional(),
})

/**
 * Admin subscription change. Stripe-backed rows take cancel,
 * cancel_at_period_end or resume, made in Stripe; a row with no Stripe
 * subscription (dev, manual) takes set_status.
 */
export const adminSubscriptionChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("cancel_at_period_end") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("set_status"), status: z.enum(["active", "canceled"]) }),
], { message: "action must be cancel, cancel_at_period_end, resume or set_status" })

export type DeployInput = z.infer<typeof deploySchema>
export type SupportTicketInput = z.infer<typeof supportTicketSchema>
export type SupportReplyInput = z.infer<typeof supportReplySchema>
export type DeletionRequestInput = z.infer<typeof deletionRequestSchema>
export type DeletionDecisionInput = z.infer<typeof deletionDecisionSchema>
