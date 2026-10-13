import { describe, it, expect } from "vitest"

import { withInstallLock } from "./byos-prebake"

describe("withInstallLock", () => {
  it("keeps the shebang first and takes the lock before anything runs", () => {
    const out = withInstallLock("#!/bin/bash\nset -euo pipefail\napt-get update", 0).split("\n")
    expect(out[0]).toBe("#!/bin/bash")
    expect(out[1]).toBe("exec 9>/var/lock/atlas-install.lock")
    expect(out[2]).toContain("flock -n 9")
    expect(out.indexOf("apt-get update")).toBeGreaterThan(2)
  })

  it("waits for a running prebake when given a wait", () => {
    expect(withInstallLock("apt-get update", 1200)).toContain("flock -w 1200 9")
  })
})
