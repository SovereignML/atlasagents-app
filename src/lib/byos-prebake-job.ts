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
import { isPinned, resolveForRegistry } from "@/lib/runtime-versions"
import { sshRunScript, type SshTarget } from "@/lib/ssh"

/**
 * The connect-time prebake job (plan 007, W7): after a customer connects a
 * server and agrees to it, install the engine-independent prerequisites and
 * the Hermes stack in the background, so the later deploy only writes config
 * and restarts. The decision logic, script and deploy-time check live in
 * byos-prebake.ts; this file runs them.
 *
 * Off unless BYOS_PREBAKE_ENABLED=true. Two product questions in plan 007 are
 * still open (which engine is the default, and the terms wording for
 * preinstalling on a customer's server), so shipping this switched on is the
 * operator's call. With it off, nothing here runs and the BYOS deploy is
 * unchanged.
 */
export function byosPrebakeEnabled(): boolean {
  return process.env.BYOS_PREBAKE_ENABLED?.trim().toLowerCase() === "true"
}

/** A prebake left "running" longer than this is presumed dead and may restart. */
const STALE_RUNNING_MS = 60 * 60 * 1000
const PREBAKE_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Decide, then (maybe) prebake the server. Safe to call after every connect or
 * re-probe: it does nothing without consent, on a box with a web-server
 * conflict or too little disk, or while another prebake of the same server is
 * running. Never throws; the outcome is on the server row.
 */
export async function runPrebake(serverId: string, facts: PreflightFacts): Promise<void> {
  if (!byosPrebakeEnabled()) return
  try {
    const server = await db.query.byosServers.findFirst({ where: eq(byosServers.id, serverId) })
    if (!server) return
    if (server.prebakeStatus === "ready") return

    const decision = prebakeDecision({ facts, consentAt: server.prebakeConsentAt })
    if (!decision.run) {
      await db
        .update(byosServers)
        .set({ prebakeStatus: decision.status, prebakeError: decision.status === "skipped" ? decision.reason : null })
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
    const openclaw = getRuntime("openclaw")
    const [openclawVersion, hermesVersion] = await Promise.all([
      resolveForRegistry(openclaw.registry, openclaw.npmPackage, openclaw.version()),
      resolveForRegistry(hermes.registry, hermes.npmPackage, hermes.version()),
    ])
    await db
      .update(byosServers)
      .set({
        prebakedOpenclawVersion: openclawVersion,
        prebakedHermesVersion: hermesVersion,
        // The chat UI is no longer prebaked (AgentWebUI Lite installs at deploy).
        prebakedWebuiVersion: null,
      })
      .where(eq(byosServers.id, serverId))

    const script = withInstallLock(
      buildPrebakeScript({ openclawVersion, hermesVersion, sshPort: server.port }),
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
  if (runtimeId !== "hermes" && runtimeId !== "openclaw") return null
  const server = await db.query.byosServers.findFirst({ where: eq(byosServers.id, byosServerId) })
  if (!server?.prebakedAt) return null

  const runtime = getRuntime(runtimeId)
  const pins: PrebakeDeployCheck["pins"] = {}
  const prebakedRuntime = runtimeId === "hermes" ? server.prebakedHermesVersion : server.prebakedOpenclawVersion
  if (prebakedRuntime && !isPinned(runtime.version())) pins.runtimeVersion = prebakedRuntime

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
