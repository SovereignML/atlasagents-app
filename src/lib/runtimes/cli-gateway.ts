/**
 * The Atlas CLI gateway — the small HTTP server that turns a coding-agent CLI
 * (Claude Code, Codex) into the same shape as Hermes: an OpenAI-compatible
 * `/v1/chat/completions` + `/v1/models` on loopback behind the gateway token,
 * which external bots and API clients talk to (the chat UI talks to the CLI
 * over ACP instead). Neither CLI ships a server of its
 * own, so this one drives them through their official SDKs
 * (`@anthropic-ai/claude-agent-sdk`'s `query()`, `@openai/codex-sdk`'s threads).
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
 *   ATLAS_ENGINE          "claude-code" | "codex"
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

const ENGINES = { "claude-code": runClaude, codex: runCodex }

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
