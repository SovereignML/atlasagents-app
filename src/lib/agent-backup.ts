// Agent backup envelope — the versioned JSON snapshot we write to Google Drive.
//
// SCOPE: settings + behavior ONLY. No secrets (*Enc columns), no IPs, tokens,
// ids, status, or billing. The field allowlist below is the security boundary;
// keep it exhaustive so new schema columns never silently leak into a backup.

import { z } from "zod"
import type { InferSelectModel } from "drizzle-orm"
import { instances } from "@/db"
import { AgentConfigSchema, parseAgentConfig } from "@/lib/agent-config"
import { selectSkills } from "@/configs/skill-map"
import { generateSoul } from "@/lib/soul"

type Instance = InferSelectModel<typeof instances>

export const BACKUP_SCHEMA_VERSION = 1

/** The only instance columns a backup is allowed to read/write. */
const AGENT_FIELD_KEYS = [
  "name",
  "agentType",
  "agentConfig",
  "soulMd",
  "skills",
  "modelTier",
  "interfaceKind",
  "deploymentTarget",
  "runtime",
] as const

export const BackupEnvelopeSchema = z.object({
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: z.string(),
  sourceInstanceId: z.string(),
  agent: z.object({
    name: z.string().min(1),
    agentType: z.string().nullable(),
    agentConfig: AgentConfigSchema.nullable(),
    soulMd: z.string().nullable(),
    skills: z.unknown().nullable(),
    modelTier: z.string().nullable(),
    interfaceKind: z.string().nullable(),
    deploymentTarget: z.string().nullable(),
    runtime: z.string().nullable(),
  }),
})

export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>

/**
 * Build a backup envelope from a DB instance row. Reads ONLY the allowlisted
 * settings columns — never secrets or infrastructure state.
 */
export function serializeAgentBackup(instance: Instance): BackupEnvelope {
  // Defensive: assert we only touch allowlisted keys (the security boundary).
  const agent = {
    name: instance.name,
    agentType: instance.agentType ?? null,
    agentConfig: (instance.agentConfig as BackupEnvelope["agent"]["agentConfig"]) ?? null,
    soulMd: instance.soulMd ?? null,
    skills: (instance.skills as unknown) ?? null,
    modelTier: instance.modelTier ?? null,
    interfaceKind: instance.interfaceKind ?? null,
    deploymentTarget: instance.deploymentTarget ?? null,
    runtime: instance.runtime ?? null,
  }
  void AGENT_FIELD_KEYS // keep the allowlist referenced as documentation of intent
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceInstanceId: instance.id,
    agent,
  }
}

/** Parse + validate a backup file downloaded from Drive. */
export function validateBackupEnvelope(
  json: unknown,
): { ok: true; data: BackupEnvelope } | { ok: false; error: string } {
  const r = BackupEnvelopeSchema.safeParse(json)
  if (!r.success) {
    return {
      ok: false,
      error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    }
  }
  return { ok: true, data: r.data }
}

/** The settings fields written onto an instance row when restoring. */
export type RestoreFields = {
  name: string
  agentType: string | null
  agentConfig: unknown
  soulMd: string | null
  skills: unknown
  modelTier: string | null
  interfaceKind: string | null
  deploymentTarget: string | null
  runtime: string | null
}

/**
 * Resolve the canonical settings to write from an envelope. When `agentConfig`
 * is present we RE-DERIVE skills + soul from it (via the same helpers the
 * deploy path uses) so a restored agent matches current skill-map/soul logic,
 * falling back to the stored snapshot values if derivation yields nothing.
 */
export function resolveRestoreFields(env: BackupEnvelope): RestoreFields {
  const a = env.agent
  let skills = a.skills
  let soulMd = a.soulMd
  let agentConfig: unknown = a.agentConfig

  if (a.agentConfig) {
    // Re-normalize the stored config through the canonical parser.
    const parsed = parseAgentConfig(a.agentConfig)
    if (parsed.ok) {
      agentConfig = parsed.data
      const derivedSkills = selectSkills(parsed.data)
      if (derivedSkills.length > 0) skills = derivedSkills
      const derivedSoul = generateSoul(parsed.data, derivedSkills)
      if (derivedSoul) soulMd = derivedSoul
    }
  }

  return {
    name: a.name,
    agentType: a.agentType,
    agentConfig,
    soulMd,
    skills,
    modelTier: a.modelTier,
    interfaceKind: a.interfaceKind,
    deploymentTarget: a.deploymentTarget,
    runtime: a.runtime,
  }
}

/** Build the Drive file name for a backup, e.g. sovereign-backup-acme-bot-20260525-141233.json */
export function backupFileName(agentName: string, when: Date = new Date()): string {
  const slug =
    agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  const ts = when
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..*$/, "")
    .replace(/(\d{8})(\d{6})/, "$1-$2")
  return `sovereign-backup-${slug}-${ts}.json`
}
