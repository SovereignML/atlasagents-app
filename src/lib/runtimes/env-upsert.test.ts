import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ENV_KEY_CHANGED,
  ENV_KEY_UNCHANGED,
  buildEnvKeyUpsertScript,
} from "./env-upsert"

/**
 * The script rewrites credentials on a live VPS, so asserting on its text would
 * prove nothing. Every case below actually runs it against a temp env file.
 */
function run(
  initial: string,
  entries: { key: string; value: string }[],
): { env: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "env-upsert-"))
  const envPath = join(dir, "open-webui.env")
  writeFileSync(envPath, initial)
  const script = buildEnvKeyUpsertScript({ envPath, entries })
  const stdout = execFileSync("bash", ["-c", script], { encoding: "utf8" })
  return { env: readFileSync(envPath, "utf8"), stdout: stdout.trim() }
}

const GATEWAY = "http://127.0.0.1:8642/v1"

describe("buildEnvKeyUpsertScript", () => {
  it("replaces a stale warm-pool placeholder token in place", () => {
    // The exact shape that leaves a claimed bot unable to chat: the sidecar is
    // still authenticating to the gateway with the bake-time placeholder, so
    // /v1/models 401s and the model dropdown is empty.
    const { env, stdout } = run(
      `WEBUI_AUTH=true\nOPENAI_API_KEY=pool-placeholder-token\nENABLE_SIGNUP=false\n`,
      [{ key: "OPENAI_API_KEY", value: "a1b2c3realtoken" }],
    )
    expect(env).toContain("OPENAI_API_KEY=a1b2c3realtoken")
    expect(env).not.toContain("pool-placeholder-token")
    expect(stdout).toBe(ENV_KEY_CHANGED)
  })

  it("appends keys the baked file never had", () => {
    // A VM baked before ENABLE_PERSISTENT_CONFIG shipped has no such line, and
    // no DEFAULT_MODELS either (the bake has no instance, so no model).
    const { env, stdout } = run(`WEBUI_AUTH=true\n`, [
      { key: "ENABLE_PERSISTENT_CONFIG", value: "false" },
      { key: "DEFAULT_MODELS", value: "minimax/minimax-m2.5" },
    ])
    expect(env).toContain("ENABLE_PERSISTENT_CONFIG=false")
    expect(env).toContain("DEFAULT_MODELS=minimax/minimax-m2.5")
    expect(stdout).toBe(ENV_KEY_CHANGED)
  })

  it("reports UNCHANGED when every key already matches, so no restart happens", () => {
    // Load-bearing: reprovisionBotEnv runs on eight routes, most of which change
    // nothing here. Restarting regardless would drop in-flight chat streams.
    const initial = `OPENAI_API_BASE_URL=${GATEWAY}\nOPENAI_API_KEY=tok\nENABLE_PERSISTENT_CONFIG=false\n`
    const { env, stdout } = run(initial, [
      { key: "OPENAI_API_BASE_URL", value: GATEWAY },
      { key: "OPENAI_API_KEY", value: "tok" },
      { key: "ENABLE_PERSISTENT_CONFIG", value: "false" },
    ])
    expect(stdout).toBe(ENV_KEY_UNCHANGED)
    expect(env).toBe(initial)
  })

  it("reports CHANGED when only one of several keys moved", () => {
    const { stdout, env } = run(
      `OPENAI_API_KEY=tok\nDEFAULT_MODELS=old/model\n`,
      [
        { key: "OPENAI_API_KEY", value: "tok" },
        { key: "DEFAULT_MODELS", value: "new/model" },
      ],
    )
    expect(stdout).toBe(ENV_KEY_CHANGED)
    expect(env).toContain("DEFAULT_MODELS=new/model")
    expect(env).toContain("OPENAI_API_KEY=tok")
  })

  it("survives slashes in the value — model slugs and URLs both carry them", () => {
    // `/` is the sed delimiter; an unescaped slug corrupts the file.
    const { env } = run(`DEFAULT_MODELS=x\nOPENAI_API_BASE_URL=http://old/v1\n`, [
      { key: "DEFAULT_MODELS", value: "anthropic/claude-sonnet-4.5" },
      { key: "OPENAI_API_BASE_URL", value: GATEWAY },
    ])
    expect(env).toContain("DEFAULT_MODELS=anthropic/claude-sonnet-4.5")
    expect(env).toContain(`OPENAI_API_BASE_URL=${GATEWAY}`)
  })

  it("never touches the session-signing key or the signup lock", () => {
    // Rotating WEBUI_SECRET_KEY logs out every chat user; reopening signup makes
    // the agent's public URL self-registering. Both are why this patches rather
    // than re-rendering.
    const { env } = run(
      `WEBUI_SECRET_KEY=sess-secret\nENABLE_SIGNUP=false\nOPENAI_API_KEY=pool-placeholder-token\n`,
      [{ key: "OPENAI_API_KEY", value: "real" }],
    )
    expect(env).toContain("WEBUI_SECRET_KEY=sess-secret")
    expect(env).toContain("ENABLE_SIGNUP=false")
  })

  it("is idempotent — a second pass reports UNCHANGED", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-upsert-"))
    const envPath = join(dir, "e.env")
    writeFileSync(envPath, `OPENAI_API_KEY=pool-placeholder-token\n`)
    const script = buildEnvKeyUpsertScript({
      envPath,
      entries: [{ key: "OPENAI_API_KEY", value: "real" }],
    })
    const first = execFileSync("bash", ["-c", script], { encoding: "utf8" }).trim()
    const second = execFileSync("bash", ["-c", script], { encoding: "utf8" }).trim()
    expect(first).toBe(ENV_KEY_CHANGED)
    expect(second).toBe(ENV_KEY_UNCHANGED)
  })

  it("fails loudly when the env file is missing rather than creating one", () => {
    // A missing file means the sidecar was never provisioned; silently creating a
    // partial env would start Open WebUI with no auth secret.
    const script = buildEnvKeyUpsertScript({
      envPath: join(tmpdir(), "definitely-not-here", "x.env"),
      entries: [{ key: "K", value: "v" }],
    })
    expect(() => execFileSync("bash", ["-c", script], { stdio: "pipe" })).toThrow()
  })

  it("preserves the file's 0600 mode — it holds the gateway bearer token", () => {
    // A `mv` from the temp file would land 0600-by-umask at best and change the
    // owner; Open WebUI runs as its own system user and must still be able to read it.
    const dir = mkdtempSync(join(tmpdir(), "env-upsert-"))
    const envPath = join(dir, "e.env")
    writeFileSync(envPath, `OPENAI_API_KEY=old\n`, { mode: 0o600 })
    chmodSync(envPath, 0o600)
    const before = statSync(envPath).mode
    execFileSync("bash", [
      "-c",
      buildEnvKeyUpsertScript({ envPath, entries: [{ key: "OPENAI_API_KEY", value: "new" }] }),
    ])
    expect(statSync(envPath).mode).toBe(before)
    expect(readFileSync(envPath, "utf8")).toContain("OPENAI_API_KEY=new")
  })

  it("collapses duplicate definitions of the same key", () => {
    // Successive hand-patches on an old box can leave two lines; dotenv takes the
    // last, but leaving a stale placeholder above the real token is a trap.
    const { env } = run(
      `OPENAI_API_KEY=pool-placeholder-token\nWEBUI_AUTH=true\nOPENAI_API_KEY=older\n`,
      [{ key: "OPENAI_API_KEY", value: "real" }],
    )
    expect(env.match(/^OPENAI_API_KEY=/gm)).toHaveLength(1)
    expect(env).toContain("OPENAI_API_KEY=real")
    expect(env).toContain("WEBUI_AUTH=true")
  })

  it("rejects a key that is not a plain dotenv identifier", () => {
    // The key is interpolated into a grep pattern; anything else is a foot-gun.
    expect(() =>
      buildEnvKeyUpsertScript({ envPath: "/tmp/x", entries: [{ key: "A KEY", value: "v" }] }),
    ).toThrow(/unsafe env key/)
  })

  it("rejects an empty entry list instead of emitting a no-op script", () => {
    expect(() => buildEnvKeyUpsertScript({ envPath: "/tmp/x", entries: [] })).toThrow(
      /at least one entry/,
    )
  })
})
