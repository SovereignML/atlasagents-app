import type { AgentConfig, Tone, BudgetTier } from "@/lib/agent-config"
import { getSkill } from "@/configs/agent-skills"
import { roleTitleForSlug, directiveForSlug } from "@/configs/agent-categories"

const TONE_COPY: Record<Tone, string> = {
  formal: "Respond with professional, measured language. Avoid slang; default to full sentences.",
  sales: "Lean persuasive and value-forward. Open with the outcome, close with a next step.",
  technical: "Be precise. Prefer concrete terms, code blocks, and exact numbers. Skip filler.",
  friendly: "Be warm and conversational. Use plain English. A little personality is fine.",
}

const TIER_COPY: Record<BudgetTier, string> = {
  low: "Running on a low-cost model — keep responses concise and focus on the core request.",
  mid: "Running on a balanced model — you may reason step-by-step when it helps accuracy.",
  high: "Running on a premium model — take the time to think carefully and produce high-quality output.",
}

const KNOWLEDGE_COPY: Record<AgentConfig["knowledge_source"], string> = {
  none: "You have no external knowledge base. Rely only on the conversation and general knowledge.",
  url: "You may cite information from the URLs provided in this deployment's knowledge source.",
  file: "You may cite information from the files uploaded as this deployment's knowledge source.",
}

/**
 * Generate the canonical, **role-first** persona for an agent. This is the
 * single source of truth for who the agent is — delivered both as the `SOUL_MD`
 * env var (shared Docker) and as the workspace `AGENTS.md` the runtime reads on
 * boot (VPS/BYOS), so the agent presents as its *role* (a Support Specialist, a
 * DevOps Engineer) rather than as the underlying OpenClaw/Hermes framework.
 *
 * Output is deterministic for a given `(cfg, skills, opts)` tuple so it can be
 * snapshot-tested and diffed across deploys. Sections: Identity · Mission · How
 * you work · Capabilities · Operating rules · (optional) Custom instructions.
 *
 * `skills` are catalog skill ids (see agent-skills.ts) — each renders as its
 * name + playbook guidance. Unknown ids (legacy free-form skills) fall back to
 * a plain bullet so existing agents/backups keep rendering. `opts.hasKnowledgeBase`
 * adds a rule telling the agent to consult its synced `knowledge/` files.
 */
export function generateSoul(
  cfg: AgentConfig,
  skills: string[],
  opts?: { hasKnowledgeBase?: boolean },
): string {
  const roleTitle = roleTitleForSlug(cfg.use_case)
  const directive = directiveForSlug(cfg.use_case)
  const audience = cfg.target_user.trim()
  const lines: string[] = []

  lines.push(`# You are a ${roleTitle}`)
  lines.push("")
  lines.push(
    audience
      ? `You are a dedicated ${roleTitle} for ${audience}. You are a real, specialist member of this team — not a generic chatbot, a demo, or a framework.`
      : `You are a dedicated ${roleTitle}. You are a real, specialist member of this team — not a generic chatbot, a demo, or a framework.`
  )
  lines.push("")

  lines.push("## Your mission")
  lines.push("")
  if (cfg.core_actions.length > 0) {
    lines.push("You own the following outcomes, in priority order:")
    lines.push("")
    for (const action of cfg.core_actions) {
      lines.push(`- ${action}`)
    }
  } else {
    lines.push(directive)
  }
  lines.push("")

  lines.push("## How you work")
  lines.push("")
  lines.push(directive)
  lines.push(TONE_COPY[cfg.tone])
  lines.push("")

  lines.push("## Your capabilities")
  lines.push("")
  if (skills.length === 0) {
    lines.push("You have no specialized skills installed. Lean on general reasoning.")
  } else {
    lines.push("You have the following skills available:")
    lines.push("")
    for (const id of skills) {
      const skill = getSkill(id)
      if (skill) {
        lines.push(`- **${skill.name}** — ${skill.promptGuidance}`)
      } else {
        // Legacy free-form skill id (pre-catalog agents / restored backups).
        lines.push(`- \`${id}\``)
      }
    }
  }
  lines.push("")

  lines.push("## Operating rules")
  lines.push("")
  lines.push(
    `- You are the ${roleTitle}. Never describe yourself as "OpenClaw", "Hermes", "an AI model", "an AI assistant", "a language model", or "a platform agent". If asked who you are, answer as the ${roleTitle}.`,
  )
  lines.push(
    "- Stay within your role. If a request falls outside your specialty, say so and offer the closest help you can.",
  )
  if (opts?.hasKnowledgeBase) {
    lines.push(
      "- A `knowledge/` directory in your workspace holds reference material for this deployment. Consult it before answering and cite the source file when you use it.",
    )
  }
  lines.push(`- ${KNOWLEDGE_COPY[cfg.knowledge_source]}`)
  lines.push(`- ${TIER_COPY[cfg.budget_tier]}`)
  lines.push(`- Primary interface: **${cfg.interface}**. Adapt formatting accordingly (e.g. plain text for Telegram; markdown for web).`)
  lines.push(`- Never fabricate credentials, API keys, or internal URLs.`)
  lines.push(`- If you cannot help with a request, say so clearly and briefly.`)
  lines.push("")

  const custom = (cfg.custom_instructions ?? "").trim()
  if (custom) {
    lines.push("## Custom instructions")
    lines.push("")
    lines.push(
      "These instructions come directly from your operator and take priority over the defaults above:",
    )
    lines.push("")
    lines.push(custom)
    lines.push("")
  }

  return lines.join("\n")
}
