import type { AgentConfig, Tone, BudgetTier } from "@/lib/agent-config"

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
 * Generate a deterministic SOUL.md persona for a bot. Output is stable for a
 * given (cfg, skills) pair so it can be snapshot-tested and diffed across
 * deploys. Sections: Identity · Purpose · Audience · Tone · Capabilities ·
 * Constraints.
 */
export function generateSoul(cfg: AgentConfig, skills: string[]): string {
  const lines: string[] = []

  lines.push("# Identity")
  lines.push("")
  lines.push(
    `You are an AI agent deployed by the SovereignML platform. Your category is **${cfg.use_case}**.`
  )
  lines.push("")

  lines.push("## Purpose")
  lines.push("")
  lines.push(
    cfg.core_actions.length > 0
      ? `You exist to help users accomplish the following, in priority order:`
      : `You exist to help users with ${cfg.use_case}-related tasks.`
  )
  if (cfg.core_actions.length > 0) {
    lines.push("")
    for (const action of cfg.core_actions) {
      lines.push(`- ${action}`)
    }
  }
  lines.push("")

  lines.push("## Audience")
  lines.push("")
  lines.push(
    cfg.target_user.trim()
      ? `Your users are: ${cfg.target_user.trim()}. Tailor examples, vocabulary, and level of detail to them.`
      : `Your users come from mixed backgrounds. Default to clear, accessible language unless asked to go deeper.`
  )
  lines.push("")

  lines.push("## Tone")
  lines.push("")
  lines.push(TONE_COPY[cfg.tone])
  lines.push("")

  lines.push("## Capabilities")
  lines.push("")
  if (skills.length === 0) {
    lines.push("You have no specialized skills installed. Lean on general reasoning.")
  } else {
    lines.push("You have the following skills available:")
    lines.push("")
    for (const skill of skills) {
      lines.push(`- \`${skill}\``)
    }
  }
  lines.push("")

  lines.push("## Constraints")
  lines.push("")
  lines.push(`- ${KNOWLEDGE_COPY[cfg.knowledge_source]}`)
  lines.push(`- ${TIER_COPY[cfg.budget_tier]}`)
  lines.push(`- Primary interface: **${cfg.interface}**. Adapt formatting accordingly (e.g. plain text for Telegram; markdown for web).`)
  lines.push(`- Never fabricate credentials, API keys, or internal URLs.`)
  lines.push(`- If you cannot help with a request, say so clearly and briefly.`)
  lines.push("")

  return lines.join("\n")
}
