import { NodeSSH } from "node-ssh"
import { db, instances, eq } from "@/db"
import { BOOTSTRAP_LOG, BOOTSTRAP_STATUS } from "./runtimes/bootstrap"

export type SshTarget = {
  host: string
  username?: string
  /** SSH port. Defaults to 22 (managed VPS); BYOS servers may use a custom port. */
  port?: number
  /**
   * Instance ID for host-key pinning. When set, the first connect captures
   * the remote host fingerprint and pins it on `instances.sshHostFingerprint`;
   * subsequent connects verify against the pinned value (TOFU). When unset,
   * connections accept any host key — only acceptable for the shared-host
   * bootstrap path which has no instance row yet.
   */
  instanceId?: string
}

function loadPrivateKey(): string {
  const raw = process.env.SSH_FLEET_PRIVATE_KEY
  if (!raw) {
    throw new Error("SSH_FLEET_PRIVATE_KEY is not set")
  }
  return normalizePem(raw)
}

/**
 * Normalize PEM-encoded strings from environment variables. Many secret
 * stores / CI systems encode newlines as literal two-character `\n`
 * sequences; PEM parsing requires real newline characters.
 */
export function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
}

/**
 * Returns true if `value` looks like it contains at least one PEM block
 * (e.g. `-----BEGIN CERTIFICATE-----`).
 */
export function isValidPem(value: string): boolean {
  return /-----BEGIN [A-Z0-9 ]+-----/.test(value)
}

async function connect(target: SshTarget): Promise<NodeSSH> {
  if (target.instanceId) {
    return connectAndPin(target, target.instanceId)
  }
  // Legacy path — no instance to pin against (shared-host bootstrap).
  const ssh = new NodeSSH()
  await ssh.connect({
    host: target.host,
    port: target.port ?? 22,
    username: target.username ?? "root",
    privateKey: loadPrivateKey(),
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
  })
  return ssh
}

/**
 * Connect AND enforce host-key pinning via TOFU.
 *
 * On the first successful connect for a given instance, we capture the remote
 * host's SHA256 fingerprint and store it on `instances.sshHostFingerprint`.
 * On every subsequent connect we compare the observed fingerprint against the
 * pinned one — mismatch means the host changed (MITM, reprovisioned VM, or
 * compromised network path) and we abort with a logged error.
 *
 * Without this, every SSH call to a Linode VM accepts whatever host key the
 * other side presents — an attacker on the network path could swap their own
 * key in and capture the fleet private key + every command we send as root.
 */
async function connectAndPin(target: SshTarget, instanceId: string): Promise<NodeSSH> {
  const ssh = new NodeSSH()
  let observed: string | null = null
  await ssh.connect({
    host: target.host,
    port: target.port ?? 22,
    username: target.username ?? "root",
    privateKey: loadPrivateKey(),
    hostHash: "sha256",
    // hostVerifier runs before the handshake completes. We accept the key
    // unconditionally here and check it against the pin AFTER connect; this
    // lets us write a clear "mismatch" error rather than ssh2's terse
    // "all configured authentication methods failed" on a fingerprint reject.
    hostVerifier: (hash: string) => {
      observed = `sha256:${hash}`
      return true
    },
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
  })

  if (!observed) {
    ssh.dispose()
    throw new Error(`SSH host fingerprint not observed for instance ${instanceId}`)
  }

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { sshHostFingerprint: true },
  })

  if (inst?.sshHostFingerprint) {
    if (inst.sshHostFingerprint !== observed) {
      ssh.dispose()
      throw new Error(
        `SSH host fingerprint mismatch for instance ${instanceId}: ` +
          `expected ${inst.sshHostFingerprint}, got ${observed}. ` +
          `Possible MITM, reprovisioned VM, or stale pin.`,
      )
    }
  } else {
    // First connect — pin it. Race with a concurrent first-connect is benign
    // because two TOFU writers see the same observed value.
    await db
      .update(instances)
      .set({ sshHostFingerprint: observed })
      .where(eq(instances.id, instanceId))
  }

  return ssh
}

/**
 * Transient SSH errors worth retrying. Excludes auth failures and host-key
 * mismatches — those are not transient and a retry would waste time or risk
 * an account lockout. "Connection lost before handshake" is the ssh2 error
 * fired when sshd closes the TCP socket during version exchange (typically
 * MaxStartups rate-limit on a freshly-provisioned VM).
 */
const TRANSIENT_SSH_ERROR_PATTERNS = [
  "Connection lost before handshake",
  "Timed out while waiting for handshake",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
] as const

function isTransientSshError(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code && (TRANSIENT_SSH_ERROR_PATTERNS as readonly string[]).includes(code)) {
    return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return TRANSIENT_SSH_ERROR_PATTERNS.some((p) => msg.includes(p))
}

/**
 * Bounded retry around `connect` for transient handshake/socket failures.
 * 3 attempts total with ~1s, ~4s backoff. Non-transient errors (auth,
 * host-key mismatch) fail immediately on the first attempt.
 */
async function connectWithRetry(target: SshTarget): Promise<NodeSSH> {
  const backoffMs = [1_000, 4_000]
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await connect(target)
    } catch (err) {
      const isLast = attempt === backoffMs.length
      if (isLast || !isTransientSshError(err)) throw err
      await new Promise((r) => setTimeout(r, backoffMs[attempt]))
    }
  }
  // Unreachable — loop always returns or throws.
  throw new Error("connectWithRetry: unreachable")
}

export type SshRunResult = { stdout: string; stderr: string; code: number | null }

/**
 * Default wall-clock budget for a single SSH command when the caller doesn't
 * specify one. Without this, a remote step that hangs while the channel stays
 * open (keepalives only detect dead TCP, not application stalls) would block
 * the HTTP request indefinitely. Long operations (installs, bootstrap polling)
 * pass their own larger explicit timeouts and are unaffected.
 */
const DEFAULT_SSH_CMD_TIMEOUT_MS = 120_000

/**
 * Wall-clock guard around `ssh.execCommand`. node-ssh keepalives detect dead
 * TCP but not application-level stalls (a remote step that hangs while the
 * channel stays open). Promise.race against a setTimeout ensures the caller
 * always gets a result within the budget; on timeout we dispose the
 * connection and throw, which propagates as a normal provisioning failure.
 */
async function execWithTimeout(
  ssh: NodeSSH,
  command: string,
  timeoutMs: number | undefined,
  label: string,
): Promise<SshRunResult> {
  const exec = ssh.execCommand(command).then((r) => ({
    stdout: r.stdout,
    stderr: r.stderr,
    code: r.code ?? null,
  }))
  if (!timeoutMs || timeoutMs <= 0) return exec
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([exec, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Run an arbitrary command on a host. Throws if the SSH connect itself fails. */
export async function sshRun(
  target: SshTarget,
  command: string,
  opts: { timeoutMs?: number } = {},
): Promise<SshRunResult> {
  const ssh = await connectWithRetry(target)
  try {
    return await execWithTimeout(
      ssh,
      command,
      opts.timeoutMs ?? DEFAULT_SSH_CMD_TIMEOUT_MS,
      "ssh command",
    )
  } finally {
    ssh.dispose()
  }
}

/**
 * Run a multi-line bash script in a single SSH session (one connect/auth).
 * Script is sent as base64 so quoting/special characters are safe.
 */
export async function sshRunScript(
  target: SshTarget,
  bashScript: string,
  opts: { timeoutMs?: number } = {},
): Promise<SshRunResult> {
  const b64 = Buffer.from(bashScript, "utf8").toString("base64")
  const command = `echo '${b64}' | base64 -d | bash`
  const ssh = await connectWithRetry(target)
  try {
    return await execWithTimeout(
      ssh,
      command,
      opts.timeoutMs ?? DEFAULT_SSH_CMD_TIMEOUT_MS,
      "ssh script",
    )
  } finally {
    ssh.dispose()
  }
}

/** True if bootstrap installed valid Cloudflare origin cert/key (Full/strict to origin on :443). */
export async function sshVmHasCloudflareOriginCerts(target: SshTarget): Promise<boolean> {
  const r = await sshRun(
    target,
    "grep -q 'BEGIN' /etc/caddy/cf/origin.pem 2>/dev/null && grep -q 'BEGIN' /etc/caddy/cf/origin.key 2>/dev/null && echo 1 || echo 0",
  )
  return r.stdout.trim() === "1" && r.code === 0
}

export type SshStepResult = {
  stage: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timestamp: string
}

/**
 * Instrumented SSH command runner. Wraps `sshRun` and captures structured
 * timing/output metadata for every command executed during provisioning.
 */
export async function sshRunLogged(
  target: SshTarget,
  command: string,
  stage: string,
): Promise<SshStepResult> {
  const start = Date.now()
  const result = await sshRun(target, command)
  return {
    stage,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  }
}

/** Like `sshRunLogged` but runs a full bash script in one session via `sshRunScript`. */
export async function sshRunScriptLogged(
  target: SshTarget,
  bashScript: string,
  stage: string,
  commandSummary: string,
  opts: { timeoutMs?: number } = {},
): Promise<SshStepResult> {
  const start = Date.now()
  const result = await sshRunScript(target, bashScript, { timeoutMs: opts.timeoutMs })
  return {
    stage,
    command: commandSummary,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Poll until sshd is accepting connections. Cloud providers report
 * "running" before sshd binds, so this bridges the gap.
 */
export async function sshWaitReady(
  target: SshTarget,
  timeoutMs = 120_000,
  pollMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const r = await sshRun(target, "echo ok")
      if (r.code === 0) {
        // Verify stability: wait 2s and check again to ensure sshd
        // isn't transiently available during cloud-init.
        await new Promise((r) => setTimeout(r, 2_000))
        try {
          const r2 = await sshRun(target, "echo ok")
          if (r2.code === 0) return
        } catch {
          // Second check failed — sshd went away, keep polling
        }
      }
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(
    `SSH not ready on ${target.host} within ${timeoutMs}ms` +
      (lastErr ? `; last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : ""),
  )
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/* ------------------------------------------------------------------ */
/* VPS bootstrap — server-side script, immune to SSH drops             */
/* ------------------------------------------------------------------ */

// Bootstrap script generation moved into runtime adapters
// (src/lib/runtimes/bootstrap.ts + each runtime's renderBootstrap). This file
// only retains `sshPollBootstrap` — the matching reader side that waits for
// the bootstrap to finish — and reuses the shared status/log paths.

/** Last bytes of bootstrap.log (must be end of file — apt/npm can emit huge lines). */
const BOOTSTRAP_LOG_TAIL_BYTES = 24_000

export async function sshPollBootstrap(
  target: SshTarget,
  /** Allow npm retries + slow mirrors (see bootstrap install_runtime_pkg). */
  timeoutMs = 1_200_000,
  pollMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    let status: string
    try {
      const r = await sshRun(target, `cat ${BOOTSTRAP_STATUS} 2>/dev/null || echo pending`)
      status = r.stdout.trim()
    } catch {
      // SSH connection failed — script is still running, keep polling
      continue
    }

    if (status === "done") return

    if (status.startsWith("failed:")) {
      const failedStep = status.slice(7)
      let logTail = ""
      try {
        const logResult = await sshRun(
          target,
          `tail -c ${BOOTSTRAP_LOG_TAIL_BYTES} ${BOOTSTRAP_LOG} 2>/dev/null || echo '(no log)'`,
        )
        logTail = logResult.stdout
      } catch {
        logTail = "(could not read bootstrap log)"
      }
      throw new Error(
        `Bootstrap failed at step "${failedStep}". Log tail (last ${BOOTSTRAP_LOG_TAIL_BYTES} bytes):\n${logTail}`,
      )
    }
    // status is "running" or "pending" — keep polling
  }

  // Timeout — try to read log for diagnostics
  let logTail = ""
  try {
    const logResult = await sshRun(
      target,
      `tail -c ${BOOTSTRAP_LOG_TAIL_BYTES} ${BOOTSTRAP_LOG} 2>/dev/null || echo '(no log)'`,
    )
    logTail = logResult.stdout
  } catch {
    logTail = "(could not read bootstrap log)"
  }
  throw new Error(
    `Bootstrap timed out after ${timeoutMs / 1000}s. Log tail (last ${BOOTSTRAP_LOG_TAIL_BYTES} bytes):\n${logTail}`,
  )
}

/* ------------------------------------------------------------------ */
/* systemctl helpers                                                    */
/* ------------------------------------------------------------------ */

export async function sshSystemctlStart(target: SshTarget, service: string): Promise<SshRunResult> {
  return sshRun(target, `systemctl start ${shellEscape(service)}`)
}

export async function sshSystemctlStop(target: SshTarget, service: string): Promise<SshRunResult> {
  return sshRun(target, `systemctl stop ${shellEscape(service)}`)
}

export async function sshSystemctlRestart(target: SshTarget, service: string): Promise<SshRunResult> {
  return sshRun(target, `systemctl restart ${shellEscape(service)}`)
}

export async function sshSystemctlEnable(target: SshTarget, service: string): Promise<SshRunResult> {
  return sshRun(target, `systemctl enable ${shellEscape(service)}`)
}

export async function sshSystemctlStatus(target: SshTarget, service: string): Promise<SshRunResult> {
  return sshRun(target, `systemctl is-active ${shellEscape(service)}`)
}

/**
 * Write Caddyfile and reload the Caddy service.
 */
export async function sshInstallCaddyfile(target: SshTarget, content: string): Promise<SshRunResult> {
  const writeResult = await sshWriteFile(target, "/etc/caddy/Caddyfile", content)
  if (writeResult.code !== 0 && writeResult.code !== null) return writeResult
  return sshRun(target, "systemctl reload caddy || systemctl restart caddy")
}

/* ------------------------------------------------------------------ */
/* Docker helpers (shared-cluster path only; VPS uses systemd above)   */
/* ------------------------------------------------------------------ */

export type DockerRunOpts = {
  image: string
  containerName: string
  hostPort: number
  containerPort?: number
  env: Record<string, string>
  restart?: "always" | "unless-stopped" | "no"
  pullFirst?: boolean
}

function buildDockerRunCmd(opts: DockerRunOpts): string {
  const envFlags = Object.entries(opts.env)
    .map(([k, v]) => `-e ${shellEscape(`${k}=${v}`)}`)
    .join(" ")
  const restart = opts.restart ?? "unless-stopped"
  const containerPort = opts.containerPort ?? 3000
  return [
    "docker run -d",
    `--name ${shellEscape(opts.containerName)}`,
    `--restart ${restart}`,
    `-p ${opts.hostPort}:${containerPort}`,
    envFlags,
    shellEscape(opts.image),
  ].join(" ")
}

/** Pull-then-run. On name collision we rm -f first so retries succeed. */
export async function sshDockerRun(target: SshTarget, opts: DockerRunOpts): Promise<SshRunResult> {
  const ssh = await connectWithRetry(target)
  try {
    if (opts.pullFirst !== false) {
      await ssh.execCommand(`docker pull ${shellEscape(opts.image)}`)
    }
    await ssh.execCommand(`docker rm -f ${shellEscape(opts.containerName)} || true`)
    const r = await ssh.execCommand(buildDockerRunCmd(opts))
    return { stdout: r.stdout, stderr: r.stderr, code: r.code ?? null }
  } finally {
    ssh.dispose()
  }
}

export async function sshDockerStop(target: SshTarget, containerName: string): Promise<SshRunResult> {
  return sshRun(target, `docker stop ${shellEscape(containerName)}`)
}

export async function sshDockerStart(target: SshTarget, containerName: string): Promise<SshRunResult> {
  return sshRun(target, `docker start ${shellEscape(containerName)}`)
}

export async function sshDockerRestart(target: SshTarget, containerName: string): Promise<SshRunResult> {
  return sshRun(target, `docker restart ${shellEscape(containerName)}`)
}

export async function sshDockerRm(target: SshTarget, containerName: string): Promise<SshRunResult> {
  return sshRun(target, `docker rm -f ${shellEscape(containerName)}`)
}

/* ------------------------------------------------------------------ */
/* file + firewall helpers (unchanged)                                 */
/* ------------------------------------------------------------------ */

/**
 * Write a file on the remote host. Creates parent dirs. Contents are
 * base64-encoded in transit to preserve arbitrary bytes.
 */
export async function sshWriteFile(
  target: SshTarget,
  remotePath: string,
  contents: string,
  opts: { mode?: string } = {}
): Promise<SshRunResult> {
  const b64 = Buffer.from(contents, "utf8").toString("base64")
  const dir = remotePath.replace(/\/[^/]+$/, "") || "/"
  const cmd = [
    `mkdir -p ${shellEscape(dir)}`,
    `echo ${shellEscape(b64)} | base64 -d > ${shellEscape(remotePath)}`,
    opts.mode ? `chmod ${opts.mode} ${shellEscape(remotePath)}` : null,
  ]
    .filter(Boolean)
    .join(" && ")
  return sshRun(target, cmd)
}

/** Idempotent ufw bootstrap: allow ssh/http/https/gateway and enable. */
export async function sshConfigureUfw(target: SshTarget): Promise<SshRunResult> {
  const script = [
    "command -v ufw >/dev/null 2>&1 || (apt-get update -y && apt-get install -y ufw)",
    "ufw allow 22/tcp || true",
    "ufw allow 80/tcp || true",
    "ufw allow 443/tcp || true",
    "yes | ufw enable || true",
  ].join(" && ")
  return sshRun(target, script)
}
