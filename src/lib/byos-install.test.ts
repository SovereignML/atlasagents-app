import { describe, it, expect } from "vitest"

import {
  byosConnectionFields,
  installBlockedReason,
  pickBestPlan,
  planAllowsInstall,
  planBlockedReason,
  planIsLive,
  platformOwnsHostVm,
} from "./byos-install"

const server = {
  id: "srv_1",
  host: "203.0.113.10",
  port: 2222,
  sshUser: "deploy",
  status: "reachable",
}

describe("byosConnectionFields", () => {
  it("links the instance to the server AND copies the connection onto it", () => {
    // Both halves matter: byosServerId is what agentCount / the idle cap / the
    // disconnect guard read, and the byos* copies are what the provisioner and
    // the metrics cron read. Writing one without the other is the original bug.
    expect(byosConnectionFields(server)).toEqual({
      byosServerId: "srv_1",
      byosHost: "203.0.113.10",
      byosPort: 2222,
      byosUser: "deploy",
    })
  })

  it("carries a non-default port and user through rather than defaulting them", () => {
    const fields = byosConnectionFields({ ...server, port: 22022, sshUser: "ubuntu" })
    expect(fields.byosPort).toBe(22022)
    expect(fields.byosUser).toBe("ubuntu")
  })

  it("takes the connection from the server row, never from caller input", () => {
    // The route used to accept host/port/user in the request body. Anything
    // extra on the input must be ignored, or a caller could install onto one
    // server while being billed against another.
    const fields = byosConnectionFields({
      ...server,
      // @ts-expect-error — extra keys must not survive
      byosHost: "evil.example.com",
    })
    expect(fields.byosHost).toBe("203.0.113.10")
    expect(Object.keys(fields).sort()).toEqual([
      "byosHost",
      "byosPort",
      "byosServerId",
      "byosUser",
    ])
  })
})

describe("installBlockedReason", () => {
  it("allows a reachable server", () => {
    expect(installBlockedReason(server)).toBeNull()
  })

  it("allows a server still being probed", () => {
    // "connecting" means the first probe hasn't finished, not that it failed.
    expect(installBlockedReason({ ...server, status: "connecting" })).toBeNull()
  })

  it("blocks an unreachable server and points at the fix", () => {
    const reason = installBlockedReason({ ...server, status: "unreachable" })
    expect(reason).toMatch(/can't reach/i)
    // The snapshot can be stale, so the message must offer a way out.
    expect(reason).toMatch(/refresh/i)
  })
})

describe("platformOwnsHostVm", () => {
  it("refuses to claim ownership of a BYOS machine", () => {
    // The warm pool's failure mode is a create → fail → destroy loop. Against a
    // pool VM that is a wasted bill; against a customer's own server it would be
    // destroying hardware we do not own. This predicate is the line, and
    // acquireBootedVm throws on it.
    expect(platformOwnsHostVm("byos")).toBe(false)
  })

  it("owns the machines it provisioned itself", () => {
    expect(platformOwnsHostVm("vps")).toBe(true)
    expect(platformOwnsHostVm("shared")).toBe(true)
  })

  it("fails safe-for-the-platform, not safe-for-BYOS, on an unknown target", () => {
    // Only the literal "byos" means customer-owned. A null/unknown target is a
    // legacy or mis-set row on OUR infrastructure, and treating it as BYOS would
    // silently strand it (no VM would ever be acquired for it).
    expect(platformOwnsHostVm(null)).toBe(true)
    expect(platformOwnsHostVm(undefined)).toBe(true)
    expect(platformOwnsHostVm("")).toBe(true)
  })

  it("treats any spelling of byos as customer-owned", () => {
    // The asymmetry is the point. Mis-reading "BYOS" as platform-owned would
    // authorize deleting a customer's server; mis-reading it as BYOS only
    // strands one agent. Errors go the recoverable way.
    expect(platformOwnsHostVm("BYOS")).toBe(false)
    expect(platformOwnsHostVm("Byos")).toBe(false)
    expect(platformOwnsHostVm(" byos ")).toBe(false)
  })
})

describe("BYOS plan entitlement", () => {
  it("keeps agents covered through dunning, but not after Stripe ends the plan", () => {
    expect(planIsLive("active")).toBe(true)
    expect(planIsLive("trialing")).toBe(true)
    expect(planIsLive("past_due")).toBe(true)
    for (const s of ["canceled", "incomplete", "incomplete_expired", "unpaid", null, undefined]) {
      expect(planIsLive(s)).toBe(false)
    }
  })

  it("only lets a paid-up plan take a NEW install", () => {
    expect(planAllowsInstall("active")).toBe(true)
    expect(planAllowsInstall("trialing")).toBe(true)
    expect(planAllowsInstall("past_due")).toBe(false)
    expect(planAllowsInstall("canceled")).toBe(false)
  })

  it("explains each refusal, and has none for a paid-up plan", () => {
    expect(planBlockedReason(null)).toMatch(/needs a BYOS plan/)
    expect(planBlockedReason({ status: "past_due" })).toMatch(/unpaid invoice/)
    expect(planBlockedReason({ status: "active" })).toBeNull()
  })

  describe("pickBestPlan", () => {
    const at = (d: number) => new Date(2026, 9, d)

    it("returns null when nothing is live", () => {
      expect(pickBestPlan([])).toBeNull()
      expect(pickBestPlan([{ status: "canceled", createdAt: at(1) }])).toBeNull()
    })

    it("prefers a plan that allows installs over a newer past_due one", () => {
      const paid = { status: "active", createdAt: at(1) }
      const dunning = { status: "past_due", createdAt: at(9) }
      expect(pickBestPlan([dunning, paid])).toBe(paid)
      expect(pickBestPlan([paid, dunning])).toBe(paid)
    })

    it("takes the newest among equally-good plans", () => {
      const older = { status: "active", createdAt: at(1) }
      const newer = { status: "active", createdAt: at(5) }
      expect(pickBestPlan([older, newer])).toBe(newer)
      expect(pickBestPlan([newer, older])).toBe(newer)
    })
  })
})
