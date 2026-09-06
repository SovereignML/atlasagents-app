import { describe, it, expect } from "vitest"
import { generateSoul } from "@/lib/soul"
import type { AgentConfig } from "@/lib/agent-config"
import { BRANDING } from "@/configs/branding"

const cfg: AgentConfig = {
  use_case: "support",
  target_user: "small business owners",
  core_actions: ["answer questions", "escalate when needed"],
  tone: "friendly",
  interface: "web",
  deployment_target: "shared",
  knowledge_source: "none",
  budget_tier: "mid",
  runtime: "openclaw",
  webui_enabled: false,
  custom_instructions: "",
}

describe("generateSoul — skills", () => {
  it("renders a catalog skill as name + playbook guidance", () => {
    const out = generateSoul(cfg, ["ticket_triage"])
    expect(out).toContain("Ticket triage & escalation")
    // Guidance text, not a bare id.
    expect(out).toContain("Triage each incoming request")
    expect(out).not.toContain("`ticket_triage`")
  })

  it("falls back to a raw bullet for unknown (legacy) skill ids", () => {
    const out = generateSoul(cfg, ["triage_ticket"]) // legacy pre-catalog id
    expect(out).toContain("`triage_ticket`")
  })

  it("adds the Knowledge Base constraint only when enabled", () => {
    const without = generateSoul(cfg, [])
    expect(without).not.toContain("`knowledge/`")
    const withKb = generateSoul(cfg, [], { hasKnowledgeBase: true })
    expect(withKb).toContain("`knowledge/`")
  })
})

describe("generateSoul — role-first identity", () => {
  it("opens as the role, not as the framework or a category dump", () => {
    const out = generateSoul(cfg, [])
    expect(out).toContain("# You are a Support Specialist")
    expect(out).toContain("dedicated Support Specialist for small business owners")
    // The old generic framing must be gone, and must not return under the new
    // brand either — the agent never presents as the platform.
    expect(out).not.toContain(`deployed by the ${BRANDING.legacyName} platform`)
    expect(out).not.toContain(`deployed by the ${BRANDING.name} platform`)
    expect(out).not.toContain("Your category is")
  })

  it("instructs the agent never to self-identify as the framework", () => {
    const out = generateSoul(cfg, [])
    expect(out).toContain('Never describe yourself as "OpenClaw", "Hermes"')
    expect(out).toContain("answer as the Support Specialist")
  })

  it("uses the right role title per category, falling back to Specialist", () => {
    expect(generateSoul({ ...cfg, use_case: "devops" }, [])).toContain(
      "# You are a DevOps Engineer",
    )
    expect(generateSoul({ ...cfg, use_case: "custom" }, [])).toContain(
      "# You are a Specialist",
    )
    // Unknown slug → custom fallback role.
    expect(generateSoul({ ...cfg, use_case: "nonsense" }, [])).toContain(
      "# You are a Specialist",
    )
  })

  it("appends operator custom instructions verbatim at highest priority", () => {
    const withCustom = generateSoul(
      { ...cfg, custom_instructions: "Always reply in Spanish." },
      [],
    )
    expect(withCustom).toContain("## Custom instructions")
    expect(withCustom).toContain("Always reply in Spanish.")
    // Absent section when empty.
    expect(generateSoul(cfg, [])).not.toContain("## Custom instructions")
  })

  it("is deterministic for a given input", () => {
    expect(generateSoul(cfg, ["ticket_triage"])).toBe(generateSoul(cfg, ["ticket_triage"]))
  })
})
