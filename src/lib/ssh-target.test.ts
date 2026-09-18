import { describe, expect, it } from "vitest"
import { sshHostForInstance, sshTargetForInstance, type SshTargetFields } from "./ssh-target"

function row(over: Partial<SshTargetFields> = {}): SshTargetFields {
  return {
    id: "inst_1",
    deploymentTarget: "vps",
    ipAddress: "203.0.113.10",
    byosHost: null,
    byosPort: null,
    byosUser: null,
    ...over,
  }
}

describe("sshTargetForInstance()", () => {
  it("connects to a managed VPS at its IP with no port/user override", () => {
    const t = sshTargetForInstance(row())
    expect(t).toEqual({ host: "203.0.113.10", instanceId: "inst_1" })
    expect(t.port).toBeUndefined()
    expect(t.username).toBeUndefined()
  })

  // The regression: instance-ingress.ts built a bare {host, instanceId} for
  // every target, so custom domains on a BYOS box with a non-default port or
  // user dialled root@host:22 and failed while everything else worked.
  it("carries the custom port and user for BYOS", () => {
    const t = sshTargetForInstance(
      row({ deploymentTarget: "byos", byosHost: "box.example.com", byosPort: 2222, byosUser: "deploy" }),
    )
    expect(t).toEqual({
      host: "box.example.com",
      instanceId: "inst_1",
      port: 2222,
      username: "deploy",
    })
  })

  it("defaults BYOS to 22/root when the row omits them", () => {
    const t = sshTargetForInstance(row({ deploymentTarget: "byos", byosHost: "box.example.com" }))
    expect(t.port).toBe(22)
    expect(t.username).toBe("root")
  })

  it("prefers the BYOS hostname over the recorded IP", () => {
    const t = sshTargetForInstance(
      row({ deploymentTarget: "byos", byosHost: "box.example.com", ipAddress: "203.0.113.10" }),
    )
    expect(t.host).toBe("box.example.com")
  })

  it("falls back to the IP when a BYOS row has no hostname", () => {
    const t = sshTargetForInstance(row({ deploymentTarget: "byos", ipAddress: "198.51.100.7" }))
    expect(t.host).toBe("198.51.100.7")
  })

  // Host-key pinning is what stops a swapped sshd capturing the fleet key, so
  // every target must carry instanceId — no exceptions.
  it("always sets instanceId so the host key is pinned", () => {
    for (const t of [
      sshTargetForInstance(row()),
      sshTargetForInstance(row({ deploymentTarget: "byos", byosHost: "h" })),
      sshTargetForInstance(row({ deploymentTarget: "shared" })),
    ]) {
      expect(t.instanceId).toBe("inst_1")
    }
  })

  // Elevation depends on the live login (id -u / sudo -n), not the row, so it
  // is deliberately resolved per connection rather than baked in here.
  it("never presumes elevation", () => {
    const t = sshTargetForInstance(
      row({ deploymentTarget: "byos", byosHost: "h", byosUser: "deploy" }),
    )
    expect(t.elevate).toBeUndefined()
  })
})

describe("sshHostForInstance()", () => {
  it("returns null when there is no host yet", () => {
    expect(sshHostForInstance(row({ ipAddress: null }))).toBeNull()
    expect(sshHostForInstance(row({ deploymentTarget: "byos", ipAddress: null }))).toBeNull()
  })
})
