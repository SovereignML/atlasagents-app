import { describe, it, expect } from "vitest"
import { BRANDING } from "@/configs/branding"
import { generateIdentityMd } from "@/lib/agent-identity"

describe("generateIdentityMd — role-first card", () => {
  it("leads with the role title, not the product name or category slug", () => {
    const out = generateIdentityMd("support")
    expect(out).toContain("You are the **Support Specialist**")
    expect(out).toContain("| **Role** | Support Specialist |")
    // No legacy framing. The Platform row must not come back under any brand,
    // so this asserts on the row itself rather than on a product name.
    expect(out).not.toContain("Agent Identity Card")
    expect(out).not.toContain("| **Platform** |")
    expect(out).not.toContain(BRANDING.name)
    expect(out).not.toContain(BRANDING.legacyName)
  })

  it("reminds the agent not to present as the framework", () => {
    const out = generateIdentityMd("devops")
    expect(out).toContain("DevOps Engineer")
    expect(out).toContain('Never present yourself as "OpenClaw", "Hermes"')
  })

  it("falls back to the custom role for unknown slugs", () => {
    const out = generateIdentityMd("nonsense")
    expect(out).toContain("You are the **Specialist**")
  })

  it("renders enabled skills, else an em dash", () => {
    expect(generateIdentityMd("support", { skills: [] })).toContain("| **Skills** | — |")
    const withSkill = generateIdentityMd("support", { skills: ["ticket_triage"] })
    expect(withSkill).toContain("Ticket triage")
  })
})
