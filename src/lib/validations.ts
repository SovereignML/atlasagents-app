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

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type DeployInput = z.infer<typeof deploySchema>
