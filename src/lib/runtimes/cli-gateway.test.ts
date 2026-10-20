import { afterAll, beforeAll, describe, expect, it } from "vitest"
import crypto from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { CLI_GATEWAY_SOURCE, cliGatewayPackageJson } from "./cli-gateway"

/**
 * Imports the exact source string that ships to the box (written to a temp
 * file, with ATLAS_GATEWAY_NO_LISTEN=1 so nothing binds a port) and exercises
 * its pure helpers and the turn/session logic against a fake engine.
 */
type Ev = { type: string; id?: string; text?: string; message?: string }
type Msg = { role: string; content: unknown }
type Store = { get(k: string): string | undefined; set(k: string, v: string): void; size(): number }
type Gateway = {
  bearerOk(h: unknown, k: string): boolean
  basicOk(h: unknown, u: string, sha: string): boolean
  messageText(m: Msg): string
  transcriptKey(m: Msg[]): string
  splitTurn(m: Msg[]): { prior: Msg[]; prompt: string } | null
  replayPrompt(prior: Msg[], prompt: string): string
  code(s: string): string
  describeClaudeTool(name: string, input: unknown): string
  describeCodexItem(item: unknown): string | null
  sseChunk(id: string, model: string, delta: object, finish?: string): string
  fatalProviderError(status: unknown): string | null
  codexStreamError(message: unknown): string | null
  acpAllowOption(options: unknown): { outcome: { outcome: string; optionId?: string } }
  acpUpdateEvent(update: unknown): Ev | null
  createSessionStore(path: string, max: number): Store
  completeTurn(args: {
    messages: Msg[]
    runEngine: (a: { prompt: string; resumeId?: string }) => AsyncIterable<Ev>
    sessions: Store
    emit: (s: string) => void
    signal?: AbortSignal
  }): Promise<{ text: string; sessionId?: string; error: string | null }>
}

let gw: Gateway
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "atlas-gw-"))
  const file = join(dir, "gateway.mjs")
  writeFileSync(file, CLI_GATEWAY_SOURCE)
  process.env.ATLAS_GATEWAY_NO_LISTEN = "1"
  gw = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Gateway
})

afterAll(() => {
  delete process.env.ATLAS_GATEWAY_NO_LISTEN
  rmSync(dir, { recursive: true, force: true })
})

/** A fake engine: records each call and replies with a scripted event list. */
function fakeEngine(script: (call: { prompt: string; resumeId?: string }, n: number) => Ev[]) {
  const calls: { prompt: string; resumeId?: string }[] = []
  return {
    calls,
    run(a: { prompt: string; resumeId?: string }) {
      calls.push({ prompt: a.prompt, resumeId: a.resumeId })
      const events = script(a, calls.length)
      return (async function* () {
        for (const e of events) {
          if (e.type === "throw") throw new Error(e.message)
          yield e
        }
      })()
    },
  }
}

describe("source hygiene", () => {
  it("is plain ESM with no template leftovers", () => {
    expect(CLI_GATEWAY_SOURCE).not.toContain("${")
    expect(CLI_GATEWAY_SOURCE).not.toContain("`")
    expect(CLI_GATEWAY_SOURCE.startsWith("// atlas-cli-gateway")).toBe(true)
  })

  it("declares an ESM package with the pinned dependency", () => {
    const pkg = JSON.parse(cliGatewayPackageJson({ "@openai/codex-sdk": "0.162.0" }))
    expect(pkg.type).toBe("module")
    expect(pkg.dependencies).toEqual({ "@openai/codex-sdk": "0.162.0" })
  })
})

describe("auth", () => {
  it("accepts only the exact bearer token", () => {
    expect(gw.bearerOk("Bearer s3cret", "s3cret")).toBe(true)
    expect(gw.bearerOk("bearer   s3cret ", "s3cret")).toBe(true)
    expect(gw.bearerOk("Bearer s3cre", "s3cret")).toBe(false)
    expect(gw.bearerOk(undefined, "s3cret")).toBe(false)
    expect(gw.bearerOk("Bearer ", "")).toBe(false)
  })

  it("checks terminal basic auth against the password's sha256", () => {
    const sha = crypto.createHash("sha256").update("pa:ss").digest("hex")
    const hdr = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64")
    expect(gw.basicOk(hdr("admin@x", "pa:ss"), "admin@x", sha)).toBe(true)
    expect(gw.basicOk(hdr("admin@x", "pa:ss"), "admin@x", sha.toUpperCase())).toBe(true)
    expect(gw.basicOk(hdr("admin@x", "wrong"), "admin@x", sha)).toBe(false)
    expect(gw.basicOk(hdr("other", "pa:ss"), "admin@x", sha)).toBe(false)
    expect(gw.basicOk(hdr("admin@x", "pa:ss"), "", sha)).toBe(false)
    expect(gw.basicOk("Bearer x", "admin@x", sha)).toBe(false)
  })
})

describe("message helpers", () => {
  it("reads string and multi-part content", () => {
    expect(gw.messageText({ role: "user", content: "hi" })).toBe("hi")
    expect(
      gw.messageText({
        role: "user",
        content: [
          { type: "text", text: "a" },
          { type: "image_url", image_url: {} },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb")
  })

  it("splits at the LAST user message", () => {
    const t = gw.splitTurn([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ])
    expect(t?.prompt).toBe("three")
    expect(t?.prior).toHaveLength(2)
    expect(gw.splitTurn([{ role: "system", content: "x" }])).toBeNull()
  })

  it("keys a transcript independent of surrounding whitespace", () => {
    const a = gw.transcriptKey([{ role: "assistant", content: "done\n" }])
    const b = gw.transcriptKey([{ role: "assistant", content: " done" }])
    expect(a).toBe(b)
    expect(a).not.toBe(gw.transcriptKey([{ role: "user", content: "done" }]))
  })

  it("replays earlier turns as context, or passes a first message through", () => {
    expect(gw.replayPrompt([], "hi")).toBe("hi")
    const p = gw.replayPrompt(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      "c",
    )
    expect(p).toContain("User: a")
    expect(p).toContain("Assistant: b")
    expect(p.endsWith("c")).toBe(true)
  })

  it("formats tool activity on one line without breaking inline code", () => {
    expect(gw.describeClaudeTool("Bash", { command: "ls -la\n  /tmp" })).toBe("Running `ls -la /tmp`")
    expect(gw.describeClaudeTool("Bash", { command: "echo `x`" })).toBe("Running `echo 'x'`")
    expect(gw.describeClaudeTool("mcp__x__y", {})).toBe("Using `mcp__x__y`")
    expect(gw.code("x".repeat(500)).length).toBeLessThanOrEqual(162)
    expect(gw.describeCodexItem({ type: "file_change", changes: [{ path: "a.ts" }] })).toBe("Edited `a.ts`")
    expect(gw.describeCodexItem({ type: "reasoning", text: "x" })).toBeNull()
    // Codex notices are logged, never rendered into the reply.
    expect(gw.describeCodexItem({ type: "error", message: "Model metadata not found" })).toBeNull()
  })

  it("stops on provider statuses retrying cannot fix, not on transient ones", () => {
    expect(gw.fatalProviderError(401)).toMatch(/rejected/)
    expect(gw.fatalProviderError("403")).toMatch(/rejected/)
    expect(gw.fatalProviderError(402)).toMatch(/credits/)
    expect(gw.fatalProviderError(429)).toBeNull()
    expect(gw.fatalProviderError(529)).toBeNull()
    expect(gw.fatalProviderError(undefined)).toBeNull()
  })

  it("treats Codex reconnects as transient unless the status is fatal", () => {
    // Exact shapes from codex 0.162 against OpenRouter.
    expect(gw.codexStreamError("Reconnecting... 2/5 (unexpected status 429 Too Many Requests, url: x)")).toBeNull()
    expect(gw.codexStreamError("Reconnecting... 1/5 (unexpected status 401 Unauthorized: User not found., url: x)")).toMatch(/rejected/)
    expect(gw.codexStreamError("unexpected status 402 Payment Required")).toMatch(/credits/)
    expect(gw.codexStreamError("stream disconnected")).toBe("stream disconnected")
  })

  it("frames OpenAI-style SSE chunks", () => {
    const chunk = gw.sseChunk("id1", "m", { content: "x" }, "stop")
    expect(chunk.startsWith("data: ")).toBe(true)
    expect(chunk.endsWith("\n\n")).toBe(true)
    const body = JSON.parse(chunk.slice(6))
    expect(body.object).toBe("chat.completion.chunk")
    expect(body.choices[0]).toMatchObject({ delta: { content: "x" }, finish_reason: "stop" })
  })
})

describe("session store", () => {
  it("evicts the oldest entry past its cap and persists to disk", () => {
    const path = join(dir, "sessions.json")
    const s = gw.createSessionStore(path, 2)
    s.set("a", "1")
    s.set("b", "2")
    s.set("a", "1") // refresh a
    s.set("c", "3") // evicts b
    expect(s.get("b")).toBeUndefined()
    expect(s.get("a")).toBe("1")
    const reloaded = gw.createSessionStore(path, 2)
    expect(reloaded.get("c")).toBe("3")
    expect(reloaded.size()).toBe(2)
  })
})

describe("completeTurn()", () => {
  it("starts a session, then resumes it on the next turn", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine((_c, n) => [
      { type: "session", id: "sess-1" },
      { type: "text", text: n === 1 ? "Hello!" : "Again." },
    ])
    const first: Msg[] = [{ role: "user", content: "hi" }]
    const r1 = await gw.completeTurn({ messages: first, runEngine: engine.run, sessions, emit: () => {} })
    expect(r1.text).toBe("Hello!")
    expect(engine.calls[0]).toEqual({ prompt: "hi", resumeId: undefined })

    const second: Msg[] = [...first, { role: "assistant", content: "Hello!" }, { role: "user", content: "more" }]
    await gw.completeTurn({ messages: second, runEngine: engine.run, sessions, emit: () => {} })
    // Resumed with ONLY the new message — the harness already has the rest.
    expect(engine.calls[1]).toEqual({ prompt: "more", resumeId: "sess-1" })
  })

  it("treats a system-only prefix as a new conversation", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine(() => [{ type: "text", text: "ok" }])
    await gw.completeTurn({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
      runEngine: engine.run,
      sessions,
      emit: () => {},
    })
    expect(engine.calls[0].resumeId).toBeUndefined()
    expect(engine.calls[0].prompt).toContain("System: Be brief.")
  })

  it("replays history into a fresh session when it does not know the conversation", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine(() => [{ type: "text", text: "ok" }])
    await gw.completeTurn({
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
      runEngine: engine.run,
      sessions,
      emit: () => {},
    })
    expect(engine.calls[0].resumeId).toBeUndefined()
    expect(engine.calls[0].prompt).toContain("Assistant: b")
  })

  it("falls back to a fresh session when resuming fails before any output", async () => {
    const sessions = gw.createSessionStore("", 10)
    const prior: Msg[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]
    sessions.set(gw.transcriptKey(prior), "gone")
    const engine = fakeEngine((c) =>
      c.resumeId ? [{ type: "throw", message: "no such session" }] : [{ type: "session", id: "new" }, { type: "text", text: "ok" }],
    )
    const r = await gw.completeTurn({
      messages: [...prior, { role: "user", content: "c" }],
      runEngine: engine.run,
      sessions,
      emit: () => {},
    })
    expect(engine.calls.map((c) => c.resumeId)).toEqual(["gone", undefined])
    expect(r).toMatchObject({ text: "ok", sessionId: "new", error: null })
  })

  it("separates activity and multi-message text with blank lines", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine(() => [
      { type: "break" },
      { type: "text", text: "Let me look." },
      { type: "activity", text: "Running `ls`" },
      { type: "break" },
      { type: "text", text: "Done." },
    ])
    const emitted: string[] = []
    const r = await gw.completeTurn({
      messages: [{ role: "user", content: "go" }],
      runEngine: engine.run,
      sessions,
      emit: (s) => emitted.push(s),
    })
    expect(r.text).toBe("Let me look.\n\n> Running `ls`\n\nDone.")
    expect(emitted.join("")).toBe(r.text)
  })

  it("keeps the engine's own error over the SDK's generic exit error", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine(() => [
      { type: "error", message: "401 from provider" },
      { type: "throw", message: "Codex Exec exited with code 1" },
    ])
    const r = await gw.completeTurn({ messages: [{ role: "user", content: "go" }], runEngine: engine.run, sessions, emit: () => {} })
    expect(r.error).toBe("401 from provider")
  })

  it("shows partial work and then the failure", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine(() => [
      { type: "activity", text: "Running `make`" },
      { type: "error", message: "turn failed" },
    ])
    const r = await gw.completeTurn({ messages: [{ role: "user", content: "go" }], runEngine: engine.run, sessions, emit: () => {} })
    expect(r.text).toBe("> Running `make`\n\n**Error:** turn failed")
  })

  it("surfaces an engine error without inventing text", async () => {
    const sessions = gw.createSessionStore("", 10)
    const engine = fakeEngine(() => [{ type: "error", message: "rate limited" }])
    const r = await gw.completeTurn({
      messages: [{ role: "user", content: "go" }],
      runEngine: engine.run,
      sessions,
      emit: () => {},
    })
    expect(r).toMatchObject({ text: "", error: "rate limited" })
    expect(sessions.size()).toBe(0)
  })

  it("rejects a request with no user message", async () => {
    const sessions = gw.createSessionStore("", 10)
    await expect(
      gw.completeTurn({
        messages: [{ role: "assistant", content: "x" }],
        runEngine: fakeEngine(() => []).run,
        sessions,
        emit: () => {},
      }),
    ).rejects.toThrow("no user message")
  })
})

describe("ACP engines (OpenCode, Pi)", () => {
  it("answers a permission request with the most lasting allow, else cancels", () => {
    const opts = [
      { optionId: "once", kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
    ]
    expect(gw.acpAllowOption(opts)).toEqual({ outcome: { outcome: "selected", optionId: "always" } })
    expect(gw.acpAllowOption(opts.slice(0, 1))).toEqual({ outcome: { outcome: "selected", optionId: "once" } })
    expect(gw.acpAllowOption([{ optionId: "no", kind: "reject_once" }])).toEqual({ outcome: { outcome: "cancelled" } })
    expect(gw.acpAllowOption(undefined)).toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("streams the agent's message text and names its tool calls, ignoring the rest", () => {
    expect(gw.acpUpdateEvent({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } })).toEqual({
      type: "text",
      text: "Hi",
    })
    expect(gw.acpUpdateEvent({ sessionUpdate: "tool_call", title: "Write hello.txt" })).toEqual({
      type: "activity",
      text: "Using `Write hello.txt`",
    })
    expect(gw.acpUpdateEvent({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } })).toBeNull()
    expect(gw.acpUpdateEvent({ sessionUpdate: "agent_message_chunk", content: { type: "image" } })).toBeNull()
    expect(gw.acpUpdateEvent(null)).toBeNull()
  })
})
