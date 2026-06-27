import {
  findCategory,
  roleTitleForSlug,
  directiveForSlug,
} from "@/configs/agent-categories"
import { getSkill, defaultSkillsForCategory } from "@/configs/agent-skills"

/**
 * Per-agent identity inputs. `skills` are the instance's enabled catalog skill
 * ids (`instances.skills`); when null/undefined we fall back to the category's
 * default set so legacy agents render unchanged. `hasKnowledgeBase` notes that
 * the agent has a synced `knowledge/` corpus in its workspace.
 */
export type IdentityOpts = {
  skills?: string[] | null
  hasKnowledgeBase?: boolean
}

/** Resolve the skill ids to render: explicit instance selection, else category defaults. */
function resolveSkillIds(slug: string, opts?: IdentityOpts): string[] {
  if (opts?.skills && opts.skills.length > 0) return opts.skills
  if (opts?.skills) return [] // explicit empty selection — render no skills
  return defaultSkillsForCategory(slug)
}

/** A skill id's display label: catalog name when known, else the raw id (legacy). */
function skillLabel(id: string): string {
  return getSkill(id)?.name ?? id
}

/**
 * Generate IDENTITY.md — a short, **role-first** identity card that the runtime
 * reads from its workspace on boot. It reinforces the canonical persona
 * (AGENTS.md, produced by `generateSoul`): the agent is its *role* (a Support
 * Specialist, a DevOps Engineer), not the underlying OpenClaw/Hermes framework.
 */
export function generateIdentityMd(agentType: string, opts?: IdentityOpts): string {
  const cat = findCategory(agentType)
  const roleTitle = roleTitleForSlug(agentType)
  const skillIds = resolveSkillIds(agentType, opts)

  const lines: string[] = []

  lines.push("# Identity Card")
  lines.push("")
  lines.push(`You are the **${roleTitle}** for this team.`)
  lines.push("")
  lines.push(`| Field | Value |`)
  lines.push(`|-------|-------|`)
  lines.push(`| **Role** | ${roleTitle} |`)
  lines.push(`| **Specialty** | ${cat.description} |`)
  lines.push(
    `| **Skills** | ${skillIds.length > 0 ? skillIds.map((s) => skillLabel(s)).join(", ") : "—"} |`,
  )
  lines.push(`| **Knowledge Base** | ${opts?.hasKnowledgeBase ? "enabled" : "—"} |`)
  lines.push("")

  lines.push("## How you operate")
  lines.push("")
  lines.push(directiveForSlug(agentType))
  lines.push("")

  lines.push("## What you handle")
  lines.push("")
  for (let i = 0; i < cat.examples.length; i++) {
    lines.push(`${i + 1}. ${cat.examples[i]}`)
  }
  lines.push("")

  lines.push("## Remember")
  lines.push("")
  lines.push(
    `Never present yourself as "OpenClaw", "Hermes", or "a platform agent" — you are the ${roleTitle}.`,
  )
  lines.push("")

  return lines.join("\n")
}
