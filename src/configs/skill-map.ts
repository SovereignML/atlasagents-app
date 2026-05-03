import type { AgentConfig } from "@/lib/agent-config"

/**
 * Canonical skill sets per agent category. Keys match the `slug` field of
 * AGENT_CATEGORIES (src/configs/agent-categories.ts). Unknown use_case values
 * fall back to the "custom" list via selectSkills().
 *
 * Skills are plain strings for v1 — they become bullet points in SOUL.md and
 * are persisted on Instance.skills (JSON). Behavior-level skill registries
 * (actual tool invocation) come later; for now they're descriptive.
 */
export const SKILL_MAP: Record<string, readonly string[]> = {
  automation: [
    "schedule_task",
    "parse_structured_data",
    "call_webhook",
    "read_spreadsheet",
    "send_email",
  ],
  devops: [
    "tail_logs",
    "check_service_health",
    "restart_service",
    "summarize_incident",
    "open_runbook",
  ],
  support: [
    "triage_ticket",
    "lookup_kb_article",
    "draft_reply",
    "escalate_to_human",
    "tag_sentiment",
  ],
  research: [
    "web_search",
    "scrape_page",
    "summarize_document",
    "extract_entities",
    "compare_sources",
  ],
  content: [
    "draft_post",
    "rewrite_tone",
    "generate_outline",
    "seo_optimize",
    "schedule_publish",
  ],
  sales: [
    "score_lead",
    "draft_outreach",
    "enrich_contact",
    "log_to_crm",
    "follow_up_sequence",
  ],
  social: [
    "generate_caption",
    "schedule_post",
    "reply_to_mentions",
    "analyze_engagement",
    "propose_content_calendar",
  ],
  custom: [
    "understand_request",
    "plan_steps",
    "ask_clarifying_question",
    "summarize_outcome",
  ],
} as const

/** Returns the skill list for a config, falling back to "custom" if the use_case isn't mapped. */
export function selectSkills(cfg: AgentConfig): string[] {
  const list = SKILL_MAP[cfg.use_case] ?? SKILL_MAP.custom
  return [...list]
}
