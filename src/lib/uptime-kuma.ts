// Low-level Uptime Kuma client. ALL Kuma-version-sensitive code lives here so
// the rest of the app talks to a stable surface.
//
// Two transports, because Kuma splits read and write across two auth schemes:
//
//   1. Socket.io (WRITE) — the only way to create/edit/delete monitors. Auth is
//      the Kuma admin username + password (an API key CANNOT do this). The
//      socket protocol is internal/undocumented; event names ("login", "add",
//      "editMonitor", "deleteMonitor") and the monitor payload shape can shift
//      across Kuma versions. Pin the operator's Kuma version and re-verify here
//      on upgrade.
//
//   2. /metrics (READ) — the Prometheus endpoint, HTTP Basic auth with the API
//      key as the password (username ignored). Read-only; this is what the
//      uptime-sync poller scrapes.
//
// See src/lib/uptime-monitoring.ts for the high-level orchestration that the app
// actually calls.

import { io, type Socket } from "socket.io-client"

export type KumaEnv = {
  baseUrl: string
  apiKey: string
  username: string
  password: string
  /** Allow self-signed TLS on the Kuma host (socket transport). */
  insecureTls: boolean
}

/**
 * Read Kuma config from the environment. Returns null when the feature is
 * unconfigured — every caller must treat null as "monitoring disabled" and
 * no-op rather than throwing.
 */
export function getKumaEnv(): KumaEnv | null {
  const baseUrl = process.env.UPTIME_KUMA_BASE_URL?.trim().replace(/\/+$/, "")
  const apiKey = process.env.UPTIME_KUMA_API_KEY?.trim()
  const username = process.env.UPTIME_KUMA_USERNAME?.trim()
  const password = process.env.UPTIME_KUMA_PASSWORD
  if (!baseUrl || !apiKey || !username || !password) return null
  return {
    baseUrl,
    apiKey,
    username,
    password,
    insecureTls: process.env.UPTIME_KUMA_INSECURE_TLS === "true",
  }
}

/** Whether at least the read path (/metrics scrape) is configured. */
export function isKumaConfigured(): boolean {
  return getKumaEnv() !== null
}

// ──────────────────────────────────────────────────────────────────────
// Socket.io management (write)
// ──────────────────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 12_000
const ACK_TIMEOUT_MS = 15_000

/** Promise-wrap an emit+callback, with a timeout so a wedged socket can't hang us. */
function emitAck<T = KumaAck>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Uptime Kuma "${event}" timed out after ${ACK_TIMEOUT_MS}ms`)),
      ACK_TIMEOUT_MS,
    )
    socket.emit(event, payload, (res: T) => {
      clearTimeout(timer)
      resolve(res)
    })
  })
}

type KumaAck = { ok?: boolean; msg?: string; monitorID?: number; token?: string }

/**
 * Open a short-lived authenticated socket, run `fn`, then disconnect. We connect
 * per-operation (rather than holding a long-lived socket) so a stale connection
 * can never wedge provisioning — each call is self-contained.
 */
export async function withKumaSocket<T>(
  env: KumaEnv,
  fn: (socket: Socket) => Promise<T>,
): Promise<T> {
  const socket: Socket = io(env.baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS,
    rejectUnauthorized: !env.insecureTls,
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Uptime Kuma socket connect timed out after ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      )
      socket.once("connect", () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once("connect_error", (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`Uptime Kuma socket connect failed: ${err.message}`))
      })
    })

    // 2FA token is empty — the service account must not have 2FA enabled.
    const login = await emitAck(socket, "login", {
      username: env.username,
      password: env.password,
      token: "",
    })
    if (!login?.ok) {
      throw new Error(`Uptime Kuma login rejected: ${login?.msg ?? "unknown error"}`)
    }

    return await fn(socket)
  } finally {
    socket.disconnect()
  }
}

/** Fields Kuma needs for a sane HTTP monitor. We send a complete object — the
 * "add" handler validates and rejects sparse payloads on some versions. */
export type KumaHttpMonitor = {
  /** Set on edit only; omit/undefined to create. */
  id?: number
  name: string
  url: string
}

function buildMonitorPayload(m: KumaHttpMonitor): Record<string, unknown> {
  return {
    ...(m.id ? { id: m.id } : {}),
    type: "http",
    name: m.name,
    url: m.url,
    method: "GET",
    interval: 60,
    retryInterval: 60,
    resendInterval: 0,
    maxretries: 1,
    timeout: 48,
    upsideDown: false,
    expiryNotification: false,
    ignoreTls: false,
    maxredirects: 10,
    // 2xx/3xx = "reachable". Caddy may 301→https or return 401 behind auth; widen
    // here if the public gateway needs it (see uptime-monitoring buildMonitorUrl).
    accepted_statuscodes: ["200-299", "300-399"],
    dns_resolve_type: "A",
    dns_resolve_server: "1.1.1.1",
    notificationIDList: {},
    proxyId: null,
    parent: null,
    httpBodyEncoding: "json",
    authMethod: null,
  }
}

/** Create a monitor; returns its numeric id. */
export async function addMonitor(env: KumaEnv, m: KumaHttpMonitor): Promise<number> {
  return withKumaSocket(env, async (socket) => {
    const res = await emitAck(socket, "add", buildMonitorPayload(m))
    if (!res?.ok || typeof res.monitorID !== "number") {
      throw new Error(`Uptime Kuma add monitor failed: ${res?.msg ?? "no monitorID returned"}`)
    }
    return res.monitorID
  })
}

/** Edit an existing monitor (id required). */
export async function editMonitor(env: KumaEnv, m: KumaHttpMonitor & { id: number }): Promise<void> {
  await withKumaSocket(env, async (socket) => {
    const res = await emitAck(socket, "editMonitor", buildMonitorPayload(m))
    if (!res?.ok) {
      throw new Error(`Uptime Kuma edit monitor ${m.id} failed: ${res?.msg ?? "unknown error"}`)
    }
  })
}

/** Delete a monitor by id. A "not found" is treated as success (idempotent). */
export async function deleteMonitor(env: KumaEnv, monitorId: number): Promise<void> {
  await withKumaSocket(env, async (socket) => {
    const res = await emitAck(socket, "deleteMonitor", monitorId)
    if (!res?.ok && !/not found|does not exist/i.test(res?.msg ?? "")) {
      throw new Error(`Uptime Kuma delete monitor ${monitorId} failed: ${res?.msg ?? "unknown error"}`)
    }
  })
}

// ──────────────────────────────────────────────────────────────────────
// /metrics scrape (read)
// ──────────────────────────────────────────────────────────────────────

export type KumaMonitorSnapshot = {
  /** 1=up, 0=down, 2=pending, 3=maintenance → mapped to a string. */
  status: "up" | "down" | "pending" | "maintenance" | null
  responseTimeMs: number | null
  /** 0–1, 24h sliding window when the metric is exposed. */
  uptimeRatio: number | null
  certDaysRemaining: number | null
}

const STATUS_MAP: Record<string, KumaMonitorSnapshot["status"]> = {
  "1": "up",
  "0": "down",
  "2": "pending",
  "3": "maintenance",
}

// 24h window label — older Kuma uses "24" (hours), newer uses "1d".
const DAY_WINDOWS = new Set(["24", "1d"])

/** Fetch the raw Prometheus exposition text from Kuma's /metrics endpoint. */
export async function fetchKumaMetrics(env: KumaEnv): Promise<string> {
  // Basic auth: username is ignored, password = API key. The leading ":" is the
  // empty username (RFC 7617).
  const auth = Buffer.from(`:${env.apiKey}`).toString("base64")
  const res = await fetch(`${env.baseUrl}/metrics`, {
    headers: { Authorization: `Basic ${auth}` },
    // Don't cache — we want live values every poll.
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`Uptime Kuma /metrics returned ${res.status} ${res.statusText}`)
  }
  return res.text()
}

function parseLabels(block: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!block) return out
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = m[2]
  }
  return out
}

/**
 * Parse Kuma's Prometheus output into per-monitor snapshots, keyed by the
 * numeric monitor_id label (the join key we persist on the instance). Falls back
 * to monitor_name when monitor_id is absent (very old Kuma).
 */
export function parseKumaMetrics(text: string): Map<string, KumaMonitorSnapshot> {
  const byKey = new Map<string, KumaMonitorSnapshot>()

  const get = (key: string): KumaMonitorSnapshot => {
    let snap = byKey.get(key)
    if (!snap) {
      snap = { status: null, responseTimeMs: null, uptimeRatio: null, certDaysRemaining: null }
      byKey.set(key, snap)
    }
    return snap
  }

  const lineRe = /^([a-zA-Z_][a-zA-Z0-9_]*)(\{[^}]*\})?\s+([^\s]+)\s*$/
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const m = lineRe.exec(line)
    if (!m) continue
    const [, metric, labelBlock, rawValue] = m
    if (!metric.startsWith("monitor_")) continue

    const value = Number(rawValue)
    if (!Number.isFinite(value)) continue

    const labels = parseLabels(labelBlock?.slice(1, -1))
    const key = labels.monitor_id || labels.monitor_name
    if (!key) continue

    switch (metric) {
      case "monitor_status":
        get(key).status = STATUS_MAP[String(value)] ?? null
        break
      case "monitor_response_time":
        get(key).responseTimeMs = Math.round(value)
        break
      case "monitor_uptime_ratio":
        if (DAY_WINDOWS.has(labels.window)) get(key).uptimeRatio = value
        break
      case "monitor_cert_days_remaining":
        get(key).certDaysRemaining = Math.round(value)
        break
    }
  }

  return byKey
}
