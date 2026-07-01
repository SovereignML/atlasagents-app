import { describe, it, expect } from "vitest"
import { rollbackVmOutcome } from "./rollback-outcome"

describe("rollbackVmOutcome()", () => {
  it("BYOS / pre-create failure (no vmId): clean, never mentions a reconciler", () => {
    const outcome = rollbackVmOutcome(undefined, false)
    expect(outcome.action).toBe("no_vm")
    expect(outcome.level).toBe("warn")
    expect(outcome.result).toBe("ok")
    // The regression we're guarding: BYOS has no VM, so the message must not
    // claim "VM undefined still exists — awaiting reconciler".
    expect(outcome.message).not.toMatch(/undefined/)
    expect(outcome.message).not.toMatch(/reconciler/i)
    expect(outcome.message).toContain("No VM was created")
  })

  it("vmDeleted flag is ignored when there was never a vmId", () => {
    // vmDeleted can never be true without a vmId, but the no-vm branch must win
    // regardless so a stray truthy flag can't resurrect the orphan message.
    expect(rollbackVmOutcome(undefined, true).action).toBe("no_vm")
  })

  it("VPS with VM successfully deleted: clean rollback", () => {
    const outcome = rollbackVmOutcome("vm-123", true)
    expect(outcome.action).toBe("vm_deleted")
    expect(outcome.level).toBe("warn")
    expect(outcome.result).toBe("ok")
    expect(outcome.message).toBe("Rollback complete. VM vm-123 deleted.")
  })

  it("VPS with VM that survived deletion: orphan awaiting reconciler", () => {
    const outcome = rollbackVmOutcome("vm-456", false)
    expect(outcome.action).toBe("orphan_pending")
    expect(outcome.level).toBe("error")
    expect(outcome.result).toBe("error")
    expect(outcome.message).toBe(
      "Rollback incomplete. VM vm-456 still exists — awaiting reconciler.",
    )
  })
})
