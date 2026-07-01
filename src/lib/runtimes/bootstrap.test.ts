import { describe, it, expect } from "vitest"
import { buildBootstrapFraming, BOOTSTRAP_STATUS, BOOTSTRAP_LOG } from "./bootstrap"

const opts = {
  installDir: "/opt/openclaw",
  systemUser: "openclaw",
  minNodeVersion: "22.14.0",
  gatewayPort: 3000,
}

describe("buildBootstrapFraming() — stale status/log reset", () => {
  const script = buildBootstrapFraming(opts, `step "noop"\ntrue\n`)

  it("removes any stale status + log before the first status write", () => {
    const rmIdx = script.indexOf(`rm -f "$STATUS" "$LOG"`)
    const firstWriteIdx = script.indexOf(`echo "running" > "$STATUS"`)
    expect(rmIdx).toBeGreaterThan(-1)
    expect(firstWriteIdx).toBeGreaterThan(-1)
    // The reset must happen BEFORE the first write, or a reused BYOS box with a
    // root-owned leftover status file fails the write under set -e.
    expect(rmIdx).toBeLessThan(firstWriteIdx)
  })

  it("tolerates a missing/unwritable file so the reset never aborts the bootstrap", () => {
    expect(script).toContain(`rm -f "$STATUS" "$LOG" 2>/dev/null || true`)
  })

  it("ensures the log directory exists before writing", () => {
    expect(script).toContain(`mkdir -p "$(dirname "$LOG")"`)
  })

  it("still wires the shared status/log contract used by the poller", () => {
    expect(script).toContain(`STATUS="${BOOTSTRAP_STATUS}"`)
    expect(script).toContain(`LOG="${BOOTSTRAP_LOG}"`)
    expect(script).toContain(`echo "done" > "$STATUS"`)
  })
})
