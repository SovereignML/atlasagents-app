import { describe, it, expect } from "vitest"
import {
  n8nToolService,
  N8N_PORT,
  N8N_PATH_PREFIX,
} from "@/lib/runtimes/n8n-service"

const envArgs = {
  // `instance` is only carried through for future use; the renderer doesn't read it.
  instance: {} as never,
  publicUrl: "https://x.test",
  pathPrefix: `${N8N_PATH_PREFIX}/`,
  encryptionKey: "enc-key-123",
  ownerEmail: "n8n+abcd1234@sovereignml.local",
  ownerPassword: "Sup3rSecretPassword",
}

describe("n8nToolService.renderEnv", () => {
  it("serves under the /n8n/ subpath and binds loopback only", () => {
    const env = n8nToolService.renderEnv(envArgs)
    expect(env.N8N_PATH).toBe("/n8n/")
    expect(env.N8N_HOST).toBe("127.0.0.1")
    expect(env.N8N_PORT).toBe(String(N8N_PORT))
    expect(env.N8N_LISTEN_ADDRESS).toBe("127.0.0.1")
  })

  it("carries a stable encryption key and public webhook/editor URLs", () => {
    const env = n8nToolService.renderEnv(envArgs)
    expect(env.N8N_ENCRYPTION_KEY).toBe("enc-key-123")
    expect(env.N8N_EDITOR_BASE_URL).toBe("https://x.test/n8n/")
    expect(env.WEBHOOK_URL).toBe("https://x.test/n8n/")
  })

  it("omits public URLs when the instance has no host yet", () => {
    const env = n8nToolService.renderEnv({ ...envArgs, publicUrl: null })
    expect(env.N8N_EDITOR_BASE_URL).toBeUndefined()
    expect(env.WEBHOOK_URL).toBeUndefined()
    // Still bootable — loopback config is present.
    expect(env.N8N_PATH).toBe("/n8n/")
  })
})

describe("n8nToolService.renderSystemdUnit", () => {
  it("runs `n8n start` as the dedicated n8n user with an env file", () => {
    const unit = n8nToolService.renderSystemdUnit()
    expect(unit).toContain("ExecStart=/usr/bin/n8n start")
    expect(unit).toContain("User=n8n")
    expect(unit).toContain(`EnvironmentFile=${n8nToolService.envPath}`)
    expect(unit).toContain("Restart=always")
  })
})

describe("n8nToolService.installSteps", () => {
  it("creates the system user and installs the CLI globally", () => {
    const steps = n8nToolService.installSteps()
    expect(steps).toContain("useradd --system")
    expect(steps).toContain("npm install -g")
    expect(steps).toContain("n8n")
  })
})

describe("n8nToolService.seedOwner", () => {
  it("builds an owner-setup payload for the first-run endpoint", () => {
    expect(n8nToolService.seedOwner.setupPath).toBe("/rest/owner/setup")
    const payload = n8nToolService.seedOwner.buildPayload({
      email: "a@b.c",
      password: "pw",
    })
    expect(payload).toMatchObject({ email: "a@b.c", password: "pw" })
  })
})

describe("n8nToolService routing metadata", () => {
  it("mounts at /n8n on loopback :5678 with a prefixed health path", () => {
    expect(n8nToolService.caddyPathPrefix).toBe(N8N_PATH_PREFIX)
    expect(n8nToolService.port).toBe(N8N_PORT)
    expect(n8nToolService.healthPath).toBe(`${N8N_PATH_PREFIX}/healthz`)
  })
})
