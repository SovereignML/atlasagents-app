/**
 * The Atlas CLI gateway — the small HTTP server that turns a coding-agent CLI
 * (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Grok) into the same shape as Hermes: an OpenAI-compatible
 * `/v1/chat/completions` + `/v1/models` on loopback behind the gateway token,
 * which external bots and API clients talk to (the chat UI talks to the CLI
 * over ACP instead). None of the CLIs ships a server of its
 * own, so this one drives them: Claude Code and Codex through their official
 * SDKs (`@anthropic-ai/claude-agent-sdk`'s `query()`, `@openai/codex-sdk`'s
 * threads), OpenCode, Pi, Gemini CLI and Grok over ACP, the same protocol the
 * chat UI uses. For Gemini CLI it also serves the Gemini API on loopback,
 * translated to OpenRouter (see handleGemini).
 *
 * It is written to `<installDir>/gateway/gateway.mjs` by the runtime's init
 * script on every provision and reprovision, so a fix here reaches running
 * boxes on their next reprovision without a rebuild. The SDKs themselves are
 * installed (pinned) by the bootstrap into the same directory.
 *
 * Kept as ONE self-contained ES module string with no dependencies beyond the
 * SDK so that what the tests import is byte-for-byte what ships. The pure
 * helpers are exported for those tests; importing the module with
 * `ATLAS_GATEWAY_NO_LISTEN=1` defines everything without binding a port.
 *
 * Contract with the box (all from the runtime's `.env`, via EnvironmentFile):
 *   ATLAS_ENGINE          "claude-code" | "codex" | "opencode" | "pi" |
 *                         "gemini-cli" | "grok"
 *   API_SERVER_HOST/PORT  loopback bind (PORT = the runtime's gatewayPort)
 *   API_SERVER_KEY        bearer token — same name Hermes uses, so the
 *                         provisioner's `/v1/models` check works unchanged
 *   ATLAS_MODEL           the pinned OpenRouter slug (also /v1/models' id)
 *   ATLAS_WORKSPACE       the agent's working directory (holds AGENTS.md)
 *   ATLAS_SESSIONS_PATH   JSON file mapping conversation state → session id
 *   TERMINAL_AUTH_USER /  the `/terminal` login, checked for Caddy's
 *   TERMINAL_AUTH_SHA256  `forward_auth` (sha256 of a random 24-char password)
 *   ATLAS_CODEX_BIN       Codex only: the globally installed `codex` binary,
 *                         so the API and the terminal run the same build
 *   ATLAS_ACP_COMMAND     the ACP engines: the ACP command line, space-separated
 *                         (paths only, no quoting: systemd strips quotes)
 *   ATLAS_GEMINI_MODELS_PATH  Gemini CLI only: the agent's models, one per line
 *   OPENROUTER_API_KEY    Gemini CLI only (here): the key the Gemini API
 *                         translation calls OpenRouter with
 *
 * Sessions: an OpenAI-style client resends the whole history every turn, and
 * clients have no conversation id. After each turn the gateway records
 * sha256(history + its own reply) → the harness session id; the next request's
 * history-before-the-last-user-message hashes to the same key and resumes that
 * session (the harness keeps its own transcript, tool results included). An
 * unknown history — an API client, or a gateway restart that lost the map —
 * starts a fresh session with the earlier turns replayed as context.
 */

/** Where the gateway lives under the runtime's install dir. */
export const CLI_GATEWAY_DIR = "gateway"
export const CLI_GATEWAY_FILE = "gateway.mjs"

/** `package.json` for the gateway dir: ESM, plus the pinned SDK dependency. */
export function cliGatewayPackageJson(deps: Record<string, string>): string {
  return (
    JSON.stringify(
      { name: "atlas-cli-gateway", private: true, type: "module", dependencies: deps },
      null,
      2,
    ) + "\n"
  )
}

// NOTE for editors: this is a String.raw template, so it must not contain a
// backtick or a dollar-brace sequence. The source uses BT (a backtick built at
// runtime) and plain string concatenation instead.
export const CLI_GATEWAY_SOURCE = String.raw`// atlas-cli-gateway — written by Atlas Agents on every (re)provision.
// Do not edit on the box: the next provision overwrites it.
import http from "node:http"
import crypto from "node:crypto"
import fs from "node:fs"

const env = process.env
const ENGINE = env.ATLAS_ENGINE || ""
const HOST = env.API_SERVER_HOST || "127.0.0.1"
const PORT = Number(env.API_SERVER_PORT || 0)
const API_KEY = env.API_SERVER_KEY || ""
const MODEL = env.ATLAS_MODEL || ""
const WORKSPACE = env.ATLAS_WORKSPACE || process.cwd()
const SESSIONS_PATH = env.ATLAS_SESSIONS_PATH || ""
const TERMINAL_USER = env.TERMINAL_AUTH_USER || ""
const TERMINAL_SHA256 = env.TERMINAL_AUTH_SHA256 || ""
const CODEX_BIN = env.ATLAS_CODEX_BIN || ""
const ACP_COMMAND = (env.ATLAS_ACP_COMMAND || "").split(/\s+/).filter(Boolean)
const MAX_CONCURRENT = Math.max(1, Number(env.ATLAS_MAX_CONCURRENT || 2))
const MAX_SESSIONS = 500
const MAX_BODY_BYTES = 8 * 1024 * 1024
const BT = String.fromCharCode(96)

/* ---------------- pure helpers (exported for tests) ---------------- */

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function bearerOk(header, key) {
  if (!key || typeof header !== "string") return false
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return !!m && safeEqual(m[1], key)
}

export function basicOk(header, user, sha256hex) {
  if (!user || !sha256hex || typeof header !== "string") return false
  const m = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!m) return false
  const decoded = Buffer.from(m[1], "base64").toString("utf8")
  const i = decoded.indexOf(":")
  if (i < 0) return false
  const digest = crypto.createHash("sha256").update(decoded.slice(i + 1)).digest("hex")
  // Evaluate both comparisons so a wrong user and a wrong password take the
  // same time.
  const userOk = safeEqual(decoded.slice(0, i), user)
  const passOk = safeEqual(digest, String(sha256hex).toLowerCase())
  return userOk && passOk
}

export function messageText(m) {
  if (!m) return ""
  const c = m.content
  if (typeof c === "string") return c
  if (Array.isArray(c)) {
    return c
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
  }
  return ""
}

export function transcriptKey(messages) {
  const norm = messages.map((m) => [m && m.role, messageText(m).trim()])
  return crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex")
}

export function splitTurn(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "user") {
      return { prior: messages.slice(0, i), prompt: messageText(messages[i]) }
    }
  }
  return null
}

export function hasConversation(prior) {
  return prior.some((m) => m && m.role !== "system")
}

export function replayPrompt(prior, prompt) {
  const lines = []
  for (const m of prior) {
    const t = messageText(m).trim()
    if (!t) continue
    const who = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User"
    lines.push(who + ": " + t)
  }
  if (lines.length === 0) return prompt
  return (
    "Earlier in this conversation:\n\n" +
    lines.join("\n\n") +
    "\n\nContinue the conversation. The user now says:\n\n" +
    prompt
  )
}

function oneLine(s, max) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max - 1) + "…" : t
}

export function code(s) {
  return BT + oneLine(s, 160).split(BT).join("'") + BT
}

export function describeClaudeTool(name, input) {
  const i = input || {}
  switch (name) {
    case "Bash": return "Running " + code(i.command)
    case "Read": return "Reading " + code(i.file_path)
    case "Write": return "Writing " + code(i.file_path)
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": return "Editing " + code(i.file_path || i.notebook_path)
    case "Glob":
    case "Grep": return "Searching for " + code(i.pattern)
    case "WebFetch": return "Fetching " + code(i.url)
    case "WebSearch": return "Searching the web for " + code(i.query)
    case "Task":
    case "Agent": return "Delegating to a subagent"
    case "TodoWrite": return "Updating the plan"
    default: return "Using " + code(name)
  }
}

export function describeCodexItem(item) {
  if (!item) return null
  if (item.type === "command_execution") return "Running " + code(item.command)
  if (item.type === "file_change") {
    const paths = (item.changes || []).map((c) => c.path).slice(0, 5)
    return paths.length ? "Edited " + paths.map(code).join(", ") : "Edited files"
  }
  if (item.type === "mcp_tool_call") return "Using " + code(item.server + "." + item.tool)
  if (item.type === "web_search") return "Searching the web for " + code(item.query)
  return null
}

/**
 * Classify a Codex stream "error" event. Codex reports each reconnect attempt
 * as one ("Reconnecting... 2/5 (unexpected status 429 ...)"); those are
 * transient unless the status is one retrying cannot fix. Returns the fatal
 * message, or null to keep going.
 */
export function codexStreamError(message) {
  const m = String(message || "")
  const status = /unexpected status (\d{3})/.exec(m)
  const fatal = status ? fatalProviderError(status[1]) : null
  if (fatal) return fatal
  return /^Reconnecting\.\.\./.test(m) ? null : m || "Codex error"
}

/**
 * A provider status that retrying cannot fix: a rejected key (401/403) or an
 * exhausted credit balance (402, how OpenRouter reports it). The harnesses
 * retry these with backoff for minutes; the gateway stops at the first one and
 * says why. Returns null for transient statuses (429, 5xx), which keep retrying.
 */
export function fatalProviderError(status) {
  const s = Number(status)
  if (s === 402) return "The model provider reports insufficient credits for this agent (HTTP 402). Add credits, then try again."
  if (s === 401 || s === 403) return "The model provider rejected this agent's API key (HTTP " + s + "). Reprovision the agent to refresh it."
  return null
}

export function sseChunk(id, model, delta, finish) {
  return (
    "data: " +
    JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish || null }],
    }) +
    "\n\n"
  )
}

/** In-memory LRU of conversation key → harness session id, optionally persisted. */
export function createSessionStore(path, max) {
  const map = new Map()
  if (path) {
    try {
      const raw = JSON.parse(fs.readFileSync(path, "utf8"))
      for (const [k, v] of raw) map.set(k, v)
    } catch {
      /* first run, or a corrupt file — start empty */
    }
  }
  function save() {
    if (!path) return
    try {
      const tmp = path + ".tmp"
      fs.writeFileSync(tmp, JSON.stringify([...map.entries()]), { mode: 0o600 })
      fs.renameSync(tmp, path)
    } catch (e) {
      console.error("[gateway] could not persist sessions:", e && e.message)
    }
  }
  return {
    get: (k) => map.get(k),
    set(k, v) {
      map.delete(k)
      map.set(k, v)
      while (map.size > max) map.delete(map.keys().next().value)
      save()
    },
    size: () => map.size,
  }
}

/** What to append so the next output starts a new paragraph. */
export function paragraphBreak(text) {
  if (!text || text.endsWith("\n\n")) return ""
  return text.endsWith("\n") ? "\n" : "\n\n"
}

/**
 * One chat turn: pick the session to resume (or replay history into a fresh
 * one), drive the engine, stream text through emit(), and record the new
 * conversation state. A resume that fails before producing any output is
 * retried once as a fresh session with the history replayed.
 */
export async function completeTurn({ messages, runEngine, sessions, emit, signal }) {
  const turn = splitTurn(messages)
  if (!turn || !turn.prompt.trim()) throw new Error("no user message")
  const ongoing = hasConversation(turn.prior)
  const resumeId = ongoing ? sessions.get(transcriptKey(turn.prior)) : undefined
  const freshPrompt = replayPrompt(turn.prior, turn.prompt)

  let text = ""
  let sessionId = resumeId
  let pendingBreak = false
  let error = null
  const out = (s) => {
    text += s
    emit(s)
  }

  async function attempt(resume, prompt) {
    error = null
    try {
      for await (const ev of runEngine({ prompt, resumeId: resume, signal })) {
        if (ev.type === "session") sessionId = ev.id
        else if (ev.type === "break") pendingBreak = text.length > 0
        else if (ev.type === "activity") {
          if (text) out(paragraphBreak(text))
          out("> " + ev.text + "\n\n")
          pendingBreak = false
        } else if (ev.type === "text" && ev.text) {
          if (pendingBreak && !text.endsWith("\n\n")) out("\n\n")
          pendingBreak = false
          out(ev.text)
        } else if (ev.type === "error") error = error || ev.message || "agent error"
      }
    } catch (e) {
      // Keep an error the engine already reported: the SDK's own exception on
      // the way out ("exited with code 1") is less specific.
      error = error || (e && e.message) || String(e)
    }
  }

  await attempt(resumeId, resumeId ? turn.prompt : freshPrompt)
  if (error && !text && resumeId && !(signal && signal.aborted)) {
    sessionId = undefined
    await attempt(undefined, freshPrompt)
  }
  // A turn that did some work and then failed shows the work and the reason.
  if (error && text) out(paragraphBreak(text) + "**Error:** " + error)
  if (sessionId && text) {
    sessions.set(transcriptKey([...messages, { role: "assistant", content: text }]), sessionId)
  }
  return { text, sessionId, error }
}

/* ---------------- engines ---------------- */

async function* runClaude({ prompt, resumeId, signal }) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk")
  const abortController = new AbortController()
  if (signal) signal.addEventListener("abort", () => abortController.abort(), { once: true })
  const q = query({
    prompt,
    options: {
      cwd: WORKSPACE,
      model: MODEL || undefined,
      resume: resumeId || undefined,
      // The agent runs as an unprivileged system user on its own box; that
      // user, not a permission prompt nobody is there to answer, is the fence.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
    },
  })
  const streamed = new Set()
  for await (const m of q) {
    if (m.session_id) yield { type: "session", id: m.session_id }
    if (m.parent_tool_use_id) continue
    if (m.type === "stream_event") {
      const e = m.event || {}
      if (e.type === "message_start") {
        if (e.message && e.message.id) streamed.add(e.message.id)
        yield { type: "break" }
      } else if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta") {
        yield { type: "text", text: e.delta.text }
      }
    } else if (m.type === "assistant") {
      const msg = m.message || {}
      for (const b of msg.content || []) {
        if (b.type === "tool_use") yield { type: "activity", text: describeClaudeTool(b.name, b.input) }
        else if (b.type === "text" && !streamed.has(msg.id)) {
          yield { type: "break" }
          yield { type: "text", text: b.text }
        }
      }
    } else if (m.type === "system" && m.subtype === "api_retry") {
      const fatal = fatalProviderError(m.error_status)
      if (fatal) {
        abortController.abort()
        yield { type: "error", message: fatal }
        return
      }
    } else if (m.type === "result" && (m.is_error || m.subtype !== "success")) {
      const detail = Array.isArray(m.errors) && m.errors.length ? m.errors.join("; ") : m.result
      yield { type: "error", message: detail || m.subtype || "Claude Code failed" }
    }
  }
}

async function* runCodex({ prompt, resumeId, signal }) {
  const { Codex } = await import("@openai/codex-sdk")
  const codex = new Codex(CODEX_BIN ? { codexPathOverride: CODEX_BIN } : {})
  const opts = {
    workingDirectory: WORKSPACE,
    skipGitRepoCheck: true,
    model: MODEL || undefined,
    // Same fence as Claude Code: an unprivileged user on the agent's own box.
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
  }
  const thread = resumeId ? codex.resumeThread(resumeId, opts) : codex.startThread(opts)
  const abortController = new AbortController()
  if (signal) signal.addEventListener("abort", () => abortController.abort(), { once: true })
  const { events } = await thread.runStreamed(prompt, { signal: abortController.signal })
  for await (const ev of events) {
    if (ev.type === "thread.started") yield { type: "session", id: ev.thread_id }
    else if (ev.type === "item.started" && ev.item && ev.item.type === "command_execution") {
      yield { type: "activity", text: describeCodexItem(ev.item) }
    } else if (ev.type === "item.completed" && ev.item) {
      if (ev.item.type === "agent_message") {
        yield { type: "break" }
        yield { type: "text", text: ev.item.text }
      } else if (ev.item.type === "error") {
        // Non-fatal notices (e.g. "Model metadata ... not found" for an
        // OpenRouter slug) — for the operator's log, not the user's reply.
        console.error("[gateway] codex notice:", ev.item.message)
      } else if (ev.item.type !== "command_execution") {
        const d = describeCodexItem(ev.item)
        if (d) yield { type: "activity", text: d }
      }
    } else if (ev.type === "turn.failed") {
      yield { type: "error", message: (ev.error && ev.error.message) || "Codex turn failed" }
    } else if (ev.type === "error") {
      const fatal = codexStreamError(ev.message)
      if (fatal) {
        abortController.abort()
        yield { type: "error", message: fatal }
        return
      }
      console.error("[gateway] codex:", ev.message)
    }
  }
  if (thread.id) yield { type: "session", id: thread.id }
}

/*
 * ACP agents (OpenCode, Pi, Gemini CLI, Grok): one agent process per turn, spoken to over stdio
 * as newline-delimited JSON-RPC. Resuming loads the agent's own session when
 * it can (its replayed history is not streamed again); otherwise the turn
 * fails before any output and completeTurn replays the history into a fresh
 * session. Permission requests are allowed: like the SDK engines, the agent
 * runs as an unprivileged user on its own box, and nobody is there to answer.
 */
export function acpAllowOption(options) {
  const list = Array.isArray(options) ? options : []
  const pick = list.find((o) => o && o.kind === "allow_always") || list.find((o) => o && o.kind === "allow_once")
  return pick ? { outcome: { outcome: "selected", optionId: pick.optionId } } : { outcome: { outcome: "cancelled" } }
}

export function acpUpdateEvent(update) {
  if (!update) return null
  if (update.sessionUpdate === "agent_message_chunk") {
    const c = update.content
    return c && c.type === "text" && c.text ? { type: "text", text: c.text } : null
  }
  if (update.sessionUpdate === "tool_call") return { type: "activity", text: "Using " + code(update.title || update.kind || "a tool") }
  return null
}

async function* runAcp({ prompt, resumeId, signal }) {
  if (ACP_COMMAND.length === 0) {
    yield { type: "error", message: "ATLAS_ACP_COMMAND is not set" }
    return
  }
  const { spawn } = await import("node:child_process")
  const child = spawn(ACP_COMMAND[0], ACP_COMMAND.slice(1), { cwd: WORKSPACE, stdio: ["pipe", "pipe", "inherit"] })
  const queue = []
  let wake = null
  const push = (ev) => {
    queue.push(ev)
    if (wake) {
      wake()
      wake = null
    }
  }
  const pending = new Map()
  let nextId = 0
  let replaying = false
  let sessionId = resumeId
  const send = (msg) => {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(msg) + "\n")
  }
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      send({ jsonrpc: "2.0", id, method, params })
    })
  const failAll = (why) => {
    for (const p of pending.values()) p.reject(new Error(why))
    pending.clear()
  }
  let buf = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.id != null && !msg.method) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (p) msg.error ? p.reject(new Error(msg.error.message || "agent error")) : p.resolve(msg.result)
      } else if (msg.method === "session/update") {
        const ev = replaying ? null : acpUpdateEvent(msg.params && msg.params.update)
        if (ev) push(ev)
      } else if (msg.method === "session/request_permission" && msg.id != null) {
        send({ jsonrpc: "2.0", id: msg.id, result: acpAllowOption(msg.params && msg.params.options) })
      } else if (msg.id != null) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not supported by the gateway" } })
      }
    }
  })
  child.on("error", (e) => failAll("could not start the agent: " + (e && e.message)))
  child.on("exit", (code) => failAll("the agent exited (" + code + ")"))
  const onAbort = () => {
    if (sessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })
    setTimeout(() => child.kill(), 2000).unref()
  }
  if (signal) signal.addEventListener("abort", onAbort, { once: true })
  ;(async () => {
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} })
    if (resumeId) {
      if (!(init && init.agentCapabilities && init.agentCapabilities.loadSession)) throw new Error("this agent cannot resume a session")
      replaying = true
      try {
        await request("session/load", { sessionId: resumeId, cwd: WORKSPACE, mcpServers: [] })
      } finally {
        replaying = false
      }
    } else {
      sessionId = (await request("session/new", { cwd: WORKSPACE, mcpServers: [] })).sessionId
    }
    push({ type: "session", id: sessionId })
    const r = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] })
    const stop = r && r.stopReason
    if (stop && stop !== "end_turn" && stop !== "cancelled") push({ type: "error", message: "The agent stopped: " + stop })
  })()
    .catch((e) => push({ type: "error", message: (e && e.message) || String(e) }))
    .finally(() => push(null))
  try {
    for (;;) {
      if (queue.length === 0) await new Promise((r) => (wake = r))
      const ev = queue.shift()
      if (ev === null) break
      yield ev
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort)
    child.stdin.end()
    child.kill()
  }
}

const ENGINES = {
  "claude-code": runClaude,
  codex: runCodex,
  opencode: runAcp,
  pi: runAcp,
  "gemini-cli": runAcp,
  grok: runAcp,
}

/*
 * Gemini API → OpenRouter. Gemini CLI speaks only Gemini's own REST API
 * (generateContent / streamGenerateContent), which OpenRouter does not serve.
 * On a Gemini CLI box GOOGLE_GEMINI_BASE_URL points here, so the CLI's calls
 * (from the chat UI, the gateway's own turns and the terminal alike) are
 * translated to OpenRouter chat completions on the agent's own key, metered
 * like every other engine. Loopback only: Caddy routes /v1/*, never /v1beta.
 *
 * A model the CLI asks for is google/<name> when that is one of the agent's
 * models (ATLAS_GEMINI_MODELS_PATH, one slug per line); anything else (the
 * CLI's own helper calls name models of its choosing) runs on ATLAS_MODEL, so
 * the account allowlist never sees a model it does not know.
 */
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
const GEMINI_MODELS_PATH = env.ATLAS_GEMINI_MODELS_PATH || ""

export function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema)
  if (!schema || typeof schema !== "object") return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === "propertyOrdering") continue
    if (k === "type" && typeof v === "string") out.type = v.toLowerCase()
    else if (k === "properties" && v && typeof v === "object") {
      out.properties = {}
      for (const [name, sub] of Object.entries(v)) out.properties[name] = geminiSchema(sub)
    } else out[k] = typeof v === "object" ? geminiSchema(v) : v
  }
  return out
}

function geminiText(parts) {
  return (Array.isArray(parts) ? parts : [])
    .filter((p) => p && typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
}

export function resolveGeminiModel(name, allowed, fallback) {
  const bare = String(name || "").replace(/^models\//, "")
  if (allowed.includes(bare)) return bare
  if (allowed.includes("google/" + bare)) return "google/" + bare
  return fallback || "google/" + bare
}

export function geminiToOpenAI(body, model, stream) {
  const messages = []
  const sys = body.systemInstruction
  const sysText = typeof sys === "string" ? sys : sys ? geminiText(sys.parts) : ""
  if (sysText) messages.push({ role: "system", content: sysText })
  const pending = {}
  let n = 0
  for (const c of Array.isArray(body.contents) ? body.contents : []) {
    const parts = Array.isArray(c && c.parts) ? c.parts : []
    if (c.role === "model") {
      const calls = parts
        .filter((p) => p && p.functionCall)
        .map((p) => {
          const id = p.functionCall.id || "call_" + ++n
          const name = p.functionCall.name
          ;(pending[name] = pending[name] || []).push(id)
          return { id, type: "function", function: { name, arguments: JSON.stringify(p.functionCall.args || {}) } }
        })
      const text = geminiText(parts)
      if (calls.length || text) messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    for (const p of parts) {
      if (!p || !p.functionResponse) continue
      const name = p.functionResponse.name
      const id = p.functionResponse.id || (pending[name] && pending[name].shift()) || "call_" + ++n
      messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(p.functionResponse.response || {}) })
    }
    const content = []
    for (const p of parts) {
      if (!p || p.thought) continue
      if (typeof p.text === "string" && p.text) content.push({ type: "text", text: p.text })
      else if (p.inlineData && /^image\//.test(p.inlineData.mimeType || "")) {
        content.push({ type: "image_url", image_url: { url: "data:" + p.inlineData.mimeType + ";base64," + p.inlineData.data } })
      }
    }
    if (content.length) {
      messages.push({ role: "user", content: content.every((x) => x.type === "text") ? content.map((x) => x.text).join("") : content })
    }
  }
  const out = { model, messages, stream: !!stream }
  if (stream) out.stream_options = { include_usage: true }
  const tools = []
  for (const t of Array.isArray(body.tools) ? body.tools : []) {
    for (const f of (t && t.functionDeclarations) || []) {
      tools.push({
        type: "function",
        function: {
          name: f.name,
          description: f.description || "",
          parameters: geminiSchema(f.parametersJsonSchema || f.parameters || { type: "object", properties: {} }),
        },
      })
    }
  }
  if (tools.length) out.tools = tools
  const fc = body.toolConfig && body.toolConfig.functionCallingConfig
  if (tools.length && fc) {
    const names = fc.allowedFunctionNames || []
    if (fc.mode === "NONE") out.tool_choice = "none"
    else if (fc.mode === "ANY") out.tool_choice = names.length === 1 ? { type: "function", function: { name: names[0] } } : "required"
  }
  const g = body.generationConfig || {}
  if (typeof g.temperature === "number") out.temperature = g.temperature
  if (typeof g.topP === "number") out.top_p = g.topP
  if (typeof g.maxOutputTokens === "number") out.max_tokens = g.maxOutputTokens
  if (Array.isArray(g.stopSequences) && g.stopSequences.length) out.stop = g.stopSequences
  const schema = g.responseJsonSchema || g.responseSchema
  if (schema) out.response_format = { type: "json_schema", json_schema: { name: "response", schema: geminiSchema(schema) } }
  else if (g.responseMimeType === "application/json") out.response_format = { type: "json_object" }
  const budget = g.thinkingConfig && g.thinkingConfig.thinkingBudget
  if (typeof budget === "number" && budget > 0) out.reasoning = { max_tokens: budget }
  return out
}

const GEMINI_FINISH = { stop: "STOP", length: "MAX_TOKENS", tool_calls: "STOP", content_filter: "SAFETY" }

function geminiUsage(u) {
  if (!u) return undefined
  const thoughts = u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens
  return {
    promptTokenCount: u.prompt_tokens || 0,
    candidatesTokenCount: u.completion_tokens || 0,
    totalTokenCount: u.total_tokens || 0,
    ...(thoughts ? { thoughtsTokenCount: thoughts } : {}),
  }
}

function geminiCalls(calls) {
  return calls.map((c) => {
    let args = {}
    try {
      args = JSON.parse((c.function && c.function.arguments) || "{}")
    } catch {
      args = {}
    }
    return { functionCall: { id: c.id, name: c.function && c.function.name, args } }
  })
}

export function openAIToGemini(resp, modelName) {
  const choice = (resp && resp.choices && resp.choices[0]) || {}
  const msg = choice.message || {}
  const parts = []
  if (typeof msg.content === "string" && msg.content) parts.push({ text: msg.content })
  if (Array.isArray(msg.tool_calls)) parts.push(...geminiCalls(msg.tool_calls))
  if (parts.length === 0) parts.push({ text: "" })
  return {
    candidates: [{ content: { role: "model", parts }, finishReason: GEMINI_FINISH[choice.finish_reason] || "STOP", index: 0 }],
    usageMetadata: geminiUsage(resp && resp.usage),
    modelVersion: modelName,
  }
}

/** Folds OpenRouter's SSE chunks into Gemini stream chunks; tool calls are sent whole, once complete. */
export function createGeminiStream(modelName) {
  const calls = []
  let finish = null
  let usage = null
  const chunk = (parts, extra) => ({
    candidates: [{ content: { role: "model", parts }, index: 0, ...(extra || {}) }],
    modelVersion: modelName,
  })
  return {
    push(data) {
      const out = []
      if (data && data.usage) usage = data.usage
      const choice = data && data.choices && data.choices[0]
      if (!choice) return out
      const d = choice.delta || {}
      if (typeof d.content === "string" && d.content) out.push(chunk([{ text: d.content }]))
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        const i = typeof tc.index === "number" ? tc.index : calls.length
        const cur = (calls[i] = calls[i] || { id: "", function: { name: "", arguments: "" } })
        if (tc.id) cur.id = tc.id
        if (tc.function && tc.function.name) cur.function.name += tc.function.name
        if (tc.function && tc.function.arguments) cur.function.arguments += tc.function.arguments
      }
      if (choice.finish_reason) finish = choice.finish_reason
      return out
    },
    end() {
      const parts = calls.length ? geminiCalls(calls.filter(Boolean)) : [{ text: "" }]
      const last = chunk(parts, { finishReason: GEMINI_FINISH[finish] || "STOP" })
      const meta = geminiUsage(usage)
      if (meta) last.usageMetadata = meta
      return last
    },
  }
}

function geminiAllowed() {
  if (!GEMINI_MODELS_PATH) return []
  try {
    return fs.readFileSync(GEMINI_MODELS_PATH, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function geminiError(res, status, message) {
  const names = { 400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND", 429: "RESOURCE_EXHAUSTED" }
  sendJson(res, status, { error: { code: status, message, status: names[status] || "INTERNAL" } })
}

async function handleGemini(req, res, url) {
  const key = req.headers["x-goog-api-key"] || url.searchParams.get("key") || ""
  if (!API_KEY || !safeEqual(key, API_KEY)) return geminiError(res, 401, "invalid API key")
  if (req.method === "GET") {
    const data = geminiAllowed().map((s) => ({ name: "models/" + s.replace(/^google\//, ""), supportedGenerationMethods: ["generateContent", "countTokens"] }))
    return sendJson(res, 200, { models: data })
  }
  const m = /^\/v1[a-z0-9]*\/models\/([^:]+):([A-Za-z]+)$/.exec(url.pathname)
  if (!m || req.method !== "POST") return geminiError(res, 404, "not found")
  let body
  try {
    body = await readJson(req)
  } catch (e) {
    return geminiError(res, 400, e.message)
  }
  const name = decodeURIComponent(m[1])
  const method = m[2]
  if (method === "countTokens") {
    const contents = (body.generateContentRequest && body.generateContentRequest.contents) || body.contents
    return sendJson(res, 200, { totalTokens: Math.ceil(JSON.stringify(contents || []).length / 4) })
  }
  if (method !== "generateContent" && method !== "streamGenerateContent") {
    return geminiError(res, 400, method + " is not supported on this agent")
  }
  const stream = method === "streamGenerateContent"
  const model = resolveGeminiModel(name, geminiAllowed(), MODEL)
  const abort = new AbortController()
  res.on("close", () => {
    if (!res.writableEnded) abort.abort()
  })
  const upstream = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + (env.OPENROUTER_API_KEY || ""), "Content-Type": "application/json" },
    body: JSON.stringify(geminiToOpenAI(body, model, stream)),
    signal: abort.signal,
  })
  if (!upstream.ok) {
    let message = "OpenRouter returned " + upstream.status
    try {
      const j = await upstream.json()
      if (j && j.error && j.error.message) message = j.error.message
    } catch {}
    return geminiError(res, upstream.status, message)
  }
  if (!stream) return sendJson(res, 200, openAIToGemini(await upstream.json(), name))
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
  const folder = createGeminiStream(name)
  const write = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n")
  const decoder = new TextDecoder()
  let buf = ""
  for await (const piece of upstream.body) {
    buf += decoder.decode(piece, { stream: true })
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (payload === "[DONE]") continue
      let data
      try {
        data = JSON.parse(payload)
      } catch {
        continue
      }
      if (data.error) {
        write({ error: { code: 500, message: data.error.message || "upstream error", status: "INTERNAL" } })
        return res.end()
      }
      for (const out of folder.push(data)) write(out)
    }
  }
  write(folder.end())
  res.end()
}

/* ---------------- HTTP ---------------- */

let active = 0
const waiters = []
async function acquire() {
  while (active >= MAX_CONCURRENT) await new Promise((r) => waiters.push(r))
  active++
}
function release() {
  active--
  const next = waiters.shift()
  if (next) next()
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) })
  res.end(data)
}

function apiError(res, status, message, type) {
  sendJson(res, status, { error: { message, type: type || "invalid_request_error" } })
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"))
      } catch {
        reject(new Error("invalid JSON body"))
      }
    })
    req.on("error", reject)
  })
}

async function handleChat(req, res, sessions) {
  let body
  try {
    body = await readJson(req)
  } catch (e) {
    return apiError(res, 400, e.message)
  }
  const messages = Array.isArray(body.messages) ? body.messages : null
  if (!messages || !splitTurn(messages)) return apiError(res, 400, "messages must include a user message")
  const runEngine = ENGINES[ENGINE]
  if (!runEngine) return apiError(res, 500, "gateway misconfigured: unknown engine " + ENGINE, "server_error")

  const stream = body.stream === true
  const id = "chatcmpl-" + crypto.randomBytes(12).toString("hex")
  const abort = new AbortController()
  res.on("close", () => {
    if (!res.writableEnded) abort.abort()
  })

  let keepalive = null
  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })
    res.write(sseChunk(id, MODEL, { role: "assistant", content: "" }))
    keepalive = setInterval(() => res.write(": keepalive\n\n"), 15000)
  }
  const emit = (s) => {
    if (stream && !res.writableEnded) res.write(sseChunk(id, MODEL, { content: s }))
  }

  await acquire()
  let result
  try {
    result = await completeTurn({ messages, runEngine, sessions, emit, signal: abort.signal })
  } catch (e) {
    result = { text: "", error: (e && e.message) || String(e) }
  } finally {
    release()
    if (keepalive) clearInterval(keepalive)
  }
  if (result.error) console.error("[gateway] turn error:", result.error)

  if (stream) {
    if (result.error && !result.text) emit("**Error:** " + result.error)
    if (!res.writableEnded) {
      res.write(sseChunk(id, MODEL, {}, "stop"))
      res.end("data: [DONE]\n\n")
    }
    return
  }
  if (result.error && !result.text) return apiError(res, 502, result.error, "server_error")
  sendJson(res, 200, {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
}

export function createGatewayServer(sessions) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost")
      if (url.pathname === "/health") return sendJson(res, 200, { status: "ok", engine: ENGINE })
      if (url.pathname === "/_atlas/terminal-auth") {
        if (basicOk(req.headers.authorization, TERMINAL_USER, TERMINAL_SHA256)) {
          res.writeHead(204)
          return res.end()
        }
        res.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="Agent terminal", charset="UTF-8"',
          "Content-Type": "text/plain",
        })
        return res.end("Authentication required")
      }
      if (ENGINE === "gemini-cli" && /^\/v1[a-z0-9]+\//.test(url.pathname)) return await handleGemini(req, res, url)
      if (!url.pathname.startsWith("/v1/")) return apiError(res, 404, "not found")
      if (!bearerOk(req.headers.authorization, API_KEY)) return apiError(res, 401, "invalid API key")
      if (req.method === "GET" && url.pathname === "/v1/models") {
        return sendJson(res, 200, {
          object: "list",
          data: MODEL ? [{ id: MODEL, object: "model", created: 0, owned_by: "atlas-agents" }] : [],
        })
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        return await handleChat(req, res, sessions)
      }
      return apiError(res, 404, "not found")
    } catch (e) {
      console.error("[gateway] request failed:", e)
      if (!res.headersSent) apiError(res, 500, "internal error", "server_error")
      else res.end()
    }
  })
}

if (env.ATLAS_GATEWAY_NO_LISTEN !== "1") {
  const server = createGatewayServer(createSessionStore(SESSIONS_PATH, MAX_SESSIONS))
  server.listen(PORT, HOST, () => console.log("[gateway] " + ENGINE + " listening on " + HOST + ":" + PORT))
  process.on("SIGTERM", () => server.close(() => process.exit(0)))
}
`
