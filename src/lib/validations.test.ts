import { describe, it, expect } from "vitest"
import { deploySchema, agentEventsBatchSchema, alertRuleSchema } from "./validations"

describe("deploySchema", () => {
  it("accepts a minimal valid payload and applies defaults", () => {
    const result = deploySchema.safeParse({ name: "my-agent" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.planSlug).toBe("builder")
      expect(result.data.billingInterval).toBe("month")
    }
  })

  it("accepts a full valid payload", () => {
    const result = deploySchema.safeParse({
      name: "prod-bot",
      planSlug: "operator",
      regionSlug: "us-east",
      billingInterval: "year",
      rootPassword: "longenough123",
      sshPublicKey: "ssh-ed25519 AAAA...",
      agentConfig: { type: "support" },
    })
    expect(result.success).toBe(true)
  })

  it("leaves the name to the server, but rejects an empty one", () => {
    expect(deploySchema.safeParse({}).success).toBe(true)
    expect(deploySchema.safeParse({}).data?.name).toBeUndefined()
    expect(deploySchema.safeParse({ name: "" }).success).toBe(false)
    expect(deploySchema.safeParse({ name: "   " }).success).toBe(false)
  })

  it("rejects an invalid billingInterval", () => {
    const result = deploySchema.safeParse({ name: "x", billingInterval: "weekly" })
    expect(result.success).toBe(false)
  })

  it("rejects a too-short rootPassword", () => {
    const result = deploySchema.safeParse({ name: "x", rootPassword: "short" })
    expect(result.success).toBe(false)
  })

  it("rejects a non-string name (no silent coercion)", () => {
    const result = deploySchema.safeParse({ name: 12345 })
    expect(result.success).toBe(false)
  })
})

describe("agentEventsBatchSchema", () => {
  it("accepts a minimal valid batch", () => {
    const r = agentEventsBatchSchema.safeParse({
      events: [{ id: "e1", type: "run.finished", status: "ok", tokensIn: 10, latencyMs: 200 }],
    })
    expect(r.success).toBe(true)
  })

  it("rejects an empty batch", () => {
    expect(agentEventsBatchSchema.safeParse({ events: [] }).success).toBe(false)
  })

  it("rejects an over-cap batch (>500)", () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ id: `e${i}`, type: "heartbeat" }))
    expect(agentEventsBatchSchema.safeParse({ events }).success).toBe(false)
  })

  it("rejects an unknown event type and missing id", () => {
    expect(
      agentEventsBatchSchema.safeParse({ events: [{ id: "e1", type: "bogus" }] }).success,
    ).toBe(false)
    expect(
      agentEventsBatchSchema.safeParse({ events: [{ type: "heartbeat" }] }).success,
    ).toBe(false)
  })

  it("rejects negative token/cost numbers", () => {
    expect(
      agentEventsBatchSchema.safeParse({
        events: [{ id: "e1", type: "message", tokensIn: -1 }],
      }).success,
    ).toBe(false)
  })
})

describe("alertRuleSchema", () => {
  it("applies window/cooldown/enabled defaults", () => {
    const r = alertRuleSchema.safeParse({ metric: "down", comparator: "gt", threshold: 0 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.windowMinutes).toBe(60)
      expect(r.data.cooldownMinutes).toBe(60)
      expect(r.data.enabled).toBe(true)
    }
  })

  it("rejects an unknown metric or comparator", () => {
    expect(
      alertRuleSchema.safeParse({ metric: "cpu", comparator: "gt", threshold: 1 }).success,
    ).toBe(false)
    expect(
      alertRuleSchema.safeParse({ metric: "down", comparator: "eq", threshold: 1 }).success,
    ).toBe(false)
  })
})
