import { db, byosServers, eq, and, ne, or, lt } from "@/db"
import {
  PREBAKE_VERIFY_SCRIPT,
  buildPrebakeScript,
  parsePrebakeVerify,
  prebakeDecision,
  prebakeMinNode,
  prebakeUsability,
  withInstallLock,
} from "@/lib/byos-prebake"

export { withInstallLock }
import type { PreflightFacts } from "@/lib/byos-preflight-parse"
import { sshTargetForServer } from "@/lib/byos-server"
import { getRuntime } from "@/lib/runtimes"
import { LITE_ENGINES } from "@/lib/runtimes/universal"
import { isPinned, resolveForRegistry } from "@/lib/runtime-versions"
import { sshRunScript, type SshTarget } from "@/lib/ssh"

/**
 * The connect-time prebake job (plan 007, W7): the moment a customer connects
 * a server, install the universal image (every BYOS engine, the chat UI and
 * the shared prerequisites) in the background, so the later deploy only
 * writes config and starts the chosen engine. The decision logic, script and
 * deploy-time check live in byos-prebake.ts; this file runs them.
 *
 * On by default; BYOS_PREBAKE_ENABLED=false turns it off, and the BYOS deploy
 * then installs everything itself, as before.
 */
export function byosPrebakeEnabled(): boolean {
  return process.env.BYOS_PREBAKE_ENABLED?.trim().toLowerCase() !== "false"
}

/** A prebake left "running" longer than this is presumed dead and may restart. */
const STALE_RUNNING_MS = 60 * 60 * 1000
const PREBAKE_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Decide, then (maybe) prebake the server. Safe to call after every connect or
 * re-probe: it does nothing on a box with too little disk, on one already
 * prebaked, or while another prebake of the same server is running. Never
 * throws; the outcome is on the server row.
 */
export async function runPrebake(serverId: string, facts: PreflightFacts): Promise<void> {
  if (!byosPrebakeEnabled()) return
  try {
    const server = await db.query.byosServers.findFirst({ where: eq(byosServers.id, serverId) })
    if (!server) return
    if (server.prebakeStatus === "ready") return

    const decision = prebakeDecision({ facts })
    if (!decision.run) {
      await db
        .update(byosServers)
        .set({ prebakeStatus: decision.status, prebakeError: decision.reason })
        .where(eq(byosServers.id, serverId))
      return
    }

    // Claim: one prebake per server at a time.
    const [claimed] = await db
      .update(byosServers)
      .set({ prebakeStatus: "running", prebakeStartedAt: new Date(), prebakeError: null })
      .where(
        and(
          eq(byosServers.id, serverId),
          or(
            ne(byosServers.prebakeStatus, "running"),
            lt(byosServers.prebakeStartedAt, new Date(Date.now() - STALE_RUNNING_MS)),
          ),
        ),
      )
      .returning({ id: byosServers.id })
    if (!claimed) return

    const hermes = getRuntime("hermes")
    const hermesVersion = await resolveForRegistry(hermes.registry, hermes.npmPackage, hermes.version())
    await db
      .update(byosServers)
      .set({
        // OpenClaw is not offered on BYOS and is no longer prebaked.
        prebakedOpenclawVersion: null,
        prebakedHermesVersion: hermesVersion,
        prebakedWebuiVersion: hermes.sidecar?.version() ?? null,
      })
      .where(eq(byosServers.id, serverId))

    const script = withInstallLock(
      buildPrebakeScript({
        hermesVersion,
        sshPort: server.port,
        installCaddy: decision.installCaddy,
      }),
      0,
    )
    let res: Awaited<ReturnType<typeof sshRunScript>>
    try {
      res = await sshRunScript(sshTargetForServer(server), script, { timeoutMs: PREBAKE_TIMEOUT_MS })
    } catch (err) {
      res = { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) } as typeof res
    }

    const ok = res.code === 0 || res.code === null
    await db
      .update(byosServers)
      .set(
        ok
          ? { prebakeStatus: "ready", prebakedAt: new Date(), prebakeError: null }
          : {
              prebakeStatus: res.code === 75 ? "skipped" : "failed",
              prebakeError: (res.stderr || res.stdout).trim().split("\n").slice(-5).join("\n").slice(0, 500),
            },
      )
      .where(eq(byosServers.id, serverId))
  } catch (err) {
    console.error(`[byos-prebake] ${serverId} failed:`, err)
    await db
      .update(byosServers)
      .set({ prebakeStatus: "failed", prebakeError: err instanceof Error ? err.message.slice(0, 500) : "prebake failed" })
      .where(eq(byosServers.id, serverId))
      .catch(() => {})
  }
}

/* --- Deploy time (plan 007, W8) ------------------------------------------- */

export type PrebakeDeployCheck = {
  /** One line for the instance log. */
  message: string
  fastPath: boolean
  /**
   * Versions to install: the ones prebaked, so the deploy reuses them, unless
   * the operator has since pinned that runtime in env (a pin is how a bad
   * release is rolled back, so it wins).
   */
  pins: { runtimeVersion?: string; sidecarVersion?: string }
}

/**
 * Probe a BYOS server at deploy time for what the prebake left there. Never
 * trusts `prebakeStatus`: the full bootstrap still runs either way, and this
 * only decides which versions to install and what to tell the customer.
 * Null when prebake is off or the server was never prebaked.
 */
export async function checkPrebakedServer(
  byosServerId: string | null,
  runtimeId: string,
  target: SshTarget,
): Promise<PrebakeDeployCheck | null> {
  if (!byosPrebakeEnabled() || !byosServerId) return null
  if (!(LITE_ENGINES as readonly string[]).includes(runtimeId)) return null
  const server = await db.query.byosServers.findFirst({ where: eq(byosServers.id, byosServerId) })
  if (!server?.prebakedAt) return null

  const runtime = getRuntime(runtimeId)
  const pins: PrebakeDeployCheck["pins"] = {}
  // Only Hermes' resolved version is recorded; the other engines were baked at
  // their code pins, which is what the deploy installs too.
  if (runtimeId === "hermes" && server.prebakedHermesVersion && !isPinned(runtime.version())) {
    pins.runtimeVersion = server.prebakedHermesVersion
  }

  let facts
  try {
    const res = await sshRunScript(target, PREBAKE_VERIFY_SCRIPT, { timeoutMs: 30_000 })
    facts = parsePrebakeVerify(res.stdout)
  } catch (err) {
    return {
      message: `Couldn't check the preinstall (${err instanceof Error ? err.message : String(err)}); installing everything.`,
      fastPath: false,
      pins,
    }
  }
  const usability = prebakeUsability({
    runtime: runtimeId,
    facts,
    hermesPin: pins.runtimeVersion ?? server.prebakedHermesVersion,
    minNodeVersion: prebakeMinNode(),
  })
  return {
    message: usability.fastPath
      ? "Server was preinstalled; the install step only checks and restarts."
      : `Server was preinstalled but has changed (${usability.misses.join("; ")}); installing what's missing.`,
    fastPath: usability.fastPath,
    pins,
  }
}
