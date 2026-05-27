// Shared instance-creation core.
//
// Extracted from src/app/api/deploy/route.ts so the deploy wizard and the
// backup "restore as a new agent" path build instances identically — same
// plan/region/serverConfig resolution, same agent-field derivation, same slug
// rules, same audit + initial log. Keep these in sync by routing both callers
// through here.

import crypto from "node:crypto"
import type { InferSelectModel } from "drizzle-orm"
import { db, eq, and, asc, instances, instanceLogs, regions, serverConfigs, plans } from "@/db"
import { createSlug } from "@/lib/instance"
import { findPlanBySlug, type PlanConfig } from "@/configs/plans"
import type { AgentConfig } from "@/lib/agent-config"
import { selectSkills } from "@/configs/skill-map"
import { generateSoul } from "@/lib/soul"
import { routeModel } from "@/lib/model-router"
import { logAuditEvent, type AuditAction } from "@/lib/audit"

type Instance = InferSelectModel<typeof instances>

const VPS_REQUIRED_ENV = [
  "SSH_FLEET_PRIVATE_KEY",
  "SSH_FLEET_PUBLIC_KEY",
  "OPENROUTER_API_KEY",
  "INSTANCE_ENCRYPTION_KEY",
] as const

export type CreateInstanceArgs = {
  userId: string
  name: string
  /** Already-parsed/normalized agent config; null for the legacy no-config path. */
  agentConfig: AgentConfig | null
  planSlug?: string
  regionSlug?: string
  billingInterval?: "month" | "year"
  /** Optional deploy-only extras. */
  sshKeyId?: string
  rootPasswordEnc?: string
  /** Audit metadata (defaults to action "instance.deploy"). */
  auditAction?: AuditAction
  auditMeta?: Record<string, unknown>
}

export type CreateInstanceResult =
  | {
      ok: true
      instance: Instance
      planConfig: PlanConfig
      serverConfig: InferSelectModel<typeof serverConfigs>
      region: InferSelectModel<typeof regions>
      dbPlan: InferSelectModel<typeof plans> | undefined
    }
  | { ok: false; status: number; error: string }

/**
 * Resolve plan + region + server config, derive agent fields, and insert a
 * pending Instance row. Returns a discriminated result so HTTP callers can map
 * `{ status, error }` directly to a response. Does NOT trigger provisioning,
 * Stripe, or any free-tier policy — callers own those.
 */
export async function createInstanceFromAgentFields(
  args: CreateInstanceArgs,
): Promise<CreateInstanceResult> {
  const planSlug = args.planSlug ?? "builder"
  const billingInterval = args.billingInterval ?? "month"

  // ── Resolve plan ──────────────────────────────────────────────────
  const planConfig = findPlanBySlug(planSlug)
  if (!planConfig) return { ok: false, status: 400, error: "Invalid plan" }
  if (planConfig.cta === "contact-sales") {
    return { ok: false, status: 400, error: "Enterprise plans require contacting sales" }
  }
  if (!planConfig.serverConfigSlug) {
    return { ok: false, status: 400, error: "Plan has no server configuration" }
  }

  const isVps = args.agentConfig
    ? args.agentConfig.deployment_target === "vps"
    : !!args.regionSlug

  if (isVps) {
    const missing = VPS_REQUIRED_ENV.filter((k) => !process.env[k])
    if (missing.length > 0) {
      console.error("[agent-create] VPS provisioning not configured; missing env:", missing.join(", "))
      return { ok: false, status: 503, error: "VPS provisioning is not configured on this server" }
    }
  }

  // ── Resolve region + server config ────────────────────────────────
  let region = args.regionSlug
    ? await db.query.regions.findFirst({ where: eq(regions.slug, args.regionSlug) })
    : null
  if (!region) {
    region = await db.query.regions.findFirst({
      where: eq(regions.available, true),
      orderBy: asc(regions.sortOrder),
    })
  }
  const serverConfig = await db.query.serverConfigs.findFirst({
    where: eq(serverConfigs.slug, planConfig.serverConfigSlug),
  })

  if (!region) return { ok: false, status: 500, error: "No available region found" }
  if (!serverConfig) return { ok: false, status: 500, error: "No active server config found" }
  if (isVps && !region.available) {
    return { ok: false, status: 400, error: "Invalid or unavailable region" }
  }

  // Hermes always ships with the Open WebUI sidecar (mandatory native install).
  // The sidecar needs ≥2GB RAM, so the 1GB Nanode can't host Hermes — block it
  // server-side regardless of what the form sent.
  if (args.agentConfig?.runtime === "hermes" && serverConfig.ramGb < 2) {
    return {
      ok: false,
      status: 400,
      error: "Hermes requires a plan with at least 2GB RAM. Choose Builder or higher.",
    }
  }

  // ── Derive agent fields ───────────────────────────────────────────
  const agentFields = buildAgentFields(args.agentConfig)

  // ── Insert (retry once on the slug partial-unique violation) ──────
  let instance: Instance | undefined
  for (let attempt = 0; attempt < 2 && !instance; attempt++) {
    try {
      const [row] = await db
        .insert(instances)
        .values({
          userId: args.userId,
          name: args.name.trim(),
          slug: createSlug(args.name),
          regionId: region.id,
          serverConfigId: serverConfig.id,
          sshKeyId: args.sshKeyId,
          storageGb: serverConfig.storageGb,
          billingInterval,
          status: "pending",
          rootPasswordEnc: args.rootPasswordEnc,
          ...agentFields,
        })
        .returning()
      instance = row
    } catch (err) {
      // 23505 = unique_violation; createSlug already randomizes, so a collision
      // is rare — retry once with a fresh suffix before giving up.
      const code = (err as { code?: string })?.code
      if (code === "23505" && attempt === 0) continue
      throw err
    }
  }
  if (!instance) return { ok: false, status: 500, error: "Failed to create instance" }

  await logAuditEvent({
    userId: args.userId,
    action: args.auditAction ?? "instance.deploy",
    targetType: "instance",
    targetId: instance.id,
    targetLabel: instance.name,
    meta: args.auditMeta ?? { plan: planSlug, region: args.regionSlug, billingInterval },
  })

  const dbPlan = await db.query.plans.findFirst({
    where: and(eq(plans.tier, planConfig.tier), eq(plans.isActive, true)),
  })

  await db.insert(instanceLogs).values({
    instanceId: instance.id,
    level: "info",
    message: `Instance created. Plan: ${planConfig.name}, Server: ${serverConfig.label}, Region: ${region.name}.`,
  })

  return { ok: true, instance, planConfig, serverConfig, region, dbPlan }
}

/** Derive the agent settings columns from a parsed config (or all-null). */
export function buildAgentFields(cfg: AgentConfig | null): {
  agentType: string | null
  agentConfig: unknown
  soulMd: string | null
  skills: unknown
  modelTier: string | null
  botToken: string | null
  deploymentTarget: string | null
  interfaceKind: string | null
  runtime: string | null
  webuiEnabled: boolean
} {
  if (!cfg) {
    return {
      agentType: null,
      agentConfig: null,
      soulMd: null,
      skills: null,
      modelTier: null,
      botToken: null,
      deploymentTarget: null,
      interfaceKind: null,
      runtime: null,
      webuiEnabled: false,
    }
  }
  const skills = selectSkills(cfg)
  const soulMd = generateSoul(cfg, skills)
  routeModel(cfg.budget_tier)
  return {
    agentType: cfg.use_case,
    agentConfig: cfg,
    soulMd,
    skills,
    modelTier: cfg.budget_tier,
    botToken: "sk_bot_" + crypto.randomBytes(24).toString("hex"),
    deploymentTarget: cfg.deployment_target,
    interfaceKind: cfg.interface,
    runtime: cfg.runtime,
    // Hermes always boxes Open WebUI now — every new Hermes row gets the
    // sidecar. OpenClaw never has it. Legacy Hermes rows with the column
    // stored as false keep working API-only (the Caddy renderer still handles
    // them) but new rows always flip this on.
    webuiEnabled: cfg.runtime === "hermes",
  }
}
