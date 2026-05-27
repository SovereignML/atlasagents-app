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

export const deploySchema = z.object({
  name: z.string().min(2).max(60),
  regionSlug: z.string().min(1),
  serverConfigSlug: z.string().min(1),
  billingInterval: z.enum(["month", "year"]).default("month"),
  extraStorageGb: z.number().int().min(0).max(1000).default(0),
  rootPassword: z.string().min(8).max(128).optional(),
  sshPublicKey: z.string().optional(),
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
