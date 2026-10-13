import { describe, it, expect } from "vitest"

import { buildSeedSidecarAdminScript } from "./open-webui-seed"

const script = buildSeedSidecarAdminScript({
  port: 8080,
  signupPath: "/api/v1/auths/signup",
  envPath: "/opt/open-webui/.env",
  serviceName: "open-webui",
  adminEmail: "owner@example.com",
  adminPassword: "it's-a-secret",
})

describe("buildSeedSidecarAdminScript", () => {
  it("stops and disables the sidecar before exiting when the admin can't be created", () => {
    const failure = script.slice(
      script.indexOf('if [ "${OK}" != "1" ]; then'),
      script.indexOf('echo "=== seed: lock signup ==="'),
    )
    expect(failure).toContain('systemctl disable --now "${SERVICE}"')
    expect(failure.indexOf("systemctl disable --now")).toBeLessThan(failure.indexOf("exit 1"))
  })

  it("locks signup only after the admin account exists", () => {
    expect(script.indexOf("ENABLE_SIGNUP=false")).toBeGreaterThan(
      script.indexOf('if [ "${OK}" != "1" ]; then'),
    )
  })

  it("quotes the payload so a password with a quote can't break out", () => {
    expect(script).toContain(`'{"name":"Admin","email":"owner@example.com","password":"it'\\''s-a-secret"}'`)
  })
})
