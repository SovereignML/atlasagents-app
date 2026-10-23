// Connecting and inspecting a customer-owned server.
//
// Connecting is FREE and installs nothing. We SSH in with the platform fleet
// key (which the customer adds to their own authorized_keys), read the machine,
// decide whether we could run an agent on it, and store what we found. Money
// only enters the picture when they install an agent onto the server.
//
// That ordering is the point: the old flow charged first and discovered the box
// was incompatible afterwards.
//
// Pure parsing/verdict logic lives in byos-preflight-parse.ts so it can be
// unit-tested without SSH or a database.

import type { InferSelectModel } from "drizzle-orm"
import { db, byosServers, instances, and, eq, ne, sql } from "@/db"
import { sshRunScript, type SshTarget } from "@/lib/ssh"
import { assertPublicHost } from "@/lib/net-guard"
import {
  PREFLIGHT_SCRIPT,
  parsePreflight,
  evaluatePreflight,
  isConnectable,
  type PreflightVerdict,
} from "@/lib/byos-preflight-parse"
import { estimateAgentCapacity } from "@/configs/agent-footprint"

export type ByosServer = InferSelectModel<typeof byosServers>

/**
 * How many servers a team may have connected with no agent on them. Connecting
 * is free and each server costs us a recurring SSH probe, so this stops the
 * free tier being used as a monitoring service for an unbounded fleet. Servers
 * that actually run an agent are paid for and do not count.
 */
export const MAX_IDLE_SERVERS_PER_TEAM = 5

/** Probe budget. Short: this runs inline in a request the user is waiting on. */
const PREFLIGHT_TIMEOUT_MS = 30_000

export class ByosConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly verdict?: PreflightVerdict,
  ) {
    super(message)
    this.name = "ByosConnectError"
  }
}

/** SSH target for a server row. Pins the host key once we've seen it. */
export function sshTargetForServer(
  server: Pick<ByosServer, "host" | "port" | "sshUser" | "sshElevate" | "sshHostFingerprint">,
  onHostFingerprint?: (fp: string) => void,
): SshTarget {
  return {
    host: server.host,
    port: server.port,
    username: server.sshUser,
    elevate: server.sshElevate,
    expectedHostFingerprint: server.sshHostFingerprint ?? undefined,
    onHostFingerprint,
  }
}

/**
 * Run the preflight over SSH and return what we learned. Never writes anything
 * to the server — it is a read-only probe, deliberately runnable before payment
 * and before the customer has committed to anything.
 */
export async function probeServer(
  conn: { host: string; port: number; sshUser: string; sshHostFingerprint?: string | null },
  onHostFingerprint?: (fp: string) => void,
): Promise<PreflightVerdict> {
  const target: SshTarget = {
    host: conn.host,
    port: conn.port,
    username: conn.sshUser,
    // Never elevate the probe. Everything it reads is world-readable, and a
    // missing sudo must show up as a blocker in the verdict rather than as an
    // opaque connection failure.
    elevate: false,
    expectedHostFingerprint: conn.sshHostFingerprint ?? undefined,
    onHostFingerprint,
  }
  const res = await sshRunScript(target, PREFLIGHT_SCRIPT, { timeoutMs: PREFLIGHT_TIMEOUT_MS })
  if (res.code !== 0 && res.code !== null) {
    throw new ByosConnectError(
      `The server rejected our preflight (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`,
      400,
    )
  }
  return evaluatePreflight(parsePreflight(res.stdout))
}

/** Agentless servers currently connected by a team. */
export async function countIdleServers(teamId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(byosServers)
    .where(
      and(
        eq(byosServers.teamId, teamId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${instances}
          WHERE ${instances.byosServerId} = ${byosServers.id}
            AND ${instances.status} != 'deleted'
        )`,
      ),
    )
  return row?.count ?? 0
}

export type ConnectServerInput = {
  teamId: string
  userId: string
  host: string
  port?: number
  sshUser?: string
  label?: string
}

export type ConnectServerResult = {
  server: ByosServer
  verdict: PreflightVerdict
}

/**
 * Connect (or re-connect) a server. Free: no Stripe, no instance row, nothing
 * installed on the machine.
 *
 * Throws {@link ByosConnectError} with the verdict attached when the server
 * cannot host an agent, so the caller can show the specific blockers and their
 * fixes. Conflicts (a busy :443, an existing firewall) do NOT prevent
 * connecting — they are reported and decided at install time.
 */
export async function connectServer(input: ConnectServerInput): Promise<ConnectServerResult> {
  const host = input.host.trim()
  const port = input.port ?? 22
  const sshUser = (input.sshUser ?? "root").trim() || "root"

  if (!host) throw new ByosConnectError("A hostname or IP address is required", 400)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ByosConnectError("SSH port must be between 1 and 65535", 400)
  }

  // Same SSRF guard as the agent path: we are about to open an SSH connection
  // to a user-supplied address with the fleet key, so loopback, link-local,
  // RFC1918 and cloud-metadata targets are refused before we dial.
  await assertPublicHost(host)

  const existing = await db.query.byosServers.findFirst({
    where: and(
      eq(byosServers.teamId, input.teamId),
      eq(byosServers.host, host),
      eq(byosServers.port, port),
    ),
  })

  // The cap applies to NEW connections only — re-probing a server you already
  // connected must never be refused, or a team at the cap could not refresh.
  if (!existing) {
    const idle = await countIdleServers(input.teamId)
    if (idle >= MAX_IDLE_SERVERS_PER_TEAM) {
      throw new ByosConnectError(
        `You can have ${MAX_IDLE_SERVERS_PER_TEAM} connected servers without an agent. ` +
          `Install an agent on one of them, or disconnect a server you're not using.`,
        409,
      )
    }
  }

  let fingerprint: string | null = existing?.sshHostFingerprint ?? null
  let verdict: PreflightVerdict
  try {
    verdict = await probeServer(
      { host, port, sshUser, sshHostFingerprint: fingerprint },
      (fp) => {
        fingerprint = fp
      },
    )
  } catch (err) {
    if (err instanceof ByosConnectError) throw err
    const detail = err instanceof Error ? err.message : String(err)
    // Record the failure on a server we already knew about, so the dashboard
    // shows "unreachable" with a reason instead of stale green.
    if (existing) {
      await db
        .update(byosServers)
        .set({ status: "unreachable", lastError: detail.slice(0, 500), lastCheckedAt: new Date() })
        .where(eq(byosServers.id, existing.id))
    }
    throw new ByosConnectError(
      `Couldn't reach ${host}:${port} as ${sshUser}. Check the fleet key is in that user's ` +
        `authorized_keys and the port is open. (${detail})`,
      400,
    )
  }

  if (!isConnectable(verdict)) {
    throw new ByosConnectError(
      "This server can't run an agent yet.",
      422,
      verdict,
    )
  }

  const f = verdict.facts
  const fields = {
    label: input.label?.trim() || host,
    sshUser,
    // uid 0 means we're already root and must NOT prefix sudo; a sudo-capable
    // non-root login must. Persisted so later operations don't have to re-probe
    // — this used to be resolved inline and discarded.
    sshElevate: f.uid !== 0,
    sshHostFingerprint: fingerprint,
    status: "reachable" as const,
    lastCheckedAt: new Date(),
    lastError: null,
    osId: f.osId,
    osCodename: f.osCodename,
    arch: f.arch,
    hwCpuCores: f.cpuCores,
    hwCpuLoad1: f.cpuLoad1,
    hwRamTotalMb: f.ramTotalMb,
    hwRamUsedMb: f.ramUsedMb,
    hwDiskTotalGb: f.diskTotalGb,
    hwDiskUsedGb: f.diskUsedGb,
    hwOsName: f.osName,
    hwOsVersion: f.osVersion,
    hwKernel: f.kernel,
    hwUptimeSec: f.uptimeSec,
    capacityAgents: estimateAgentCapacity({
      cpuCores: f.cpuCores,
      ramTotalMb: f.ramTotalMb,
      diskTotalGb: f.diskTotalGb,
    }),
  }

  const [server] = existing
    ? await db
        .update(byosServers)
        .set(fields)
        .where(eq(byosServers.id, existing.id))
        .returning()
    : await db
        .insert(byosServers)
        .values({ teamId: input.teamId, userId: input.userId, host, port, ...fields })
        .returning()

  return { server, verdict }
}

/** Re-probe a connected server and update its snapshot. Best-effort. */
export async function refreshServer(serverId: string): Promise<ByosServer | null> {
  return (await refreshServerWithVerdict(serverId)).server
}

/**
 * `refreshServer`, plus the preflight verdict when the probe succeeded (null
 * when it did not), for a caller that acts on it: the Refresh button starts a
 * prebake from it.
 */
export async function refreshServerWithVerdict(
  serverId: string,
): Promise<{ server: ByosServer | null; verdict: PreflightVerdict | null }> {
  const server = await db.query.byosServers.findFirst({ where: eq(byosServers.id, serverId) })
  if (!server) return { server: null, verdict: null }
  try {
    const { server: updated, verdict } = await connectServer({
      teamId: server.teamId,
      userId: server.userId,
      host: server.host,
      port: server.port,
      sshUser: server.sshUser,
      label: server.label,
    })
    return { server: updated, verdict }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const [updated] = await db
      .update(byosServers)
      .set({ status: "unreachable", lastError: detail.slice(0, 500), lastCheckedAt: new Date() })
      .where(eq(byosServers.id, serverId))
      .returning()
    return { server: updated ?? null, verdict: null }
  }
}

/** Servers for a team, each with a count of the agents installed on it. */
export async function listServersForTeam(teamId: string) {
  const rows = await db.query.byosServers.findMany({
    where: eq(byosServers.teamId, teamId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })
  const counts = await db
    .select({ serverId: instances.byosServerId, count: sql<number>`count(*)::int` })
    .from(instances)
    .where(and(ne(instances.status, "deleted"), sql`${instances.byosServerId} IS NOT NULL`))
    .groupBy(instances.byosServerId)
  const byId = new Map(counts.map((c) => [c.serverId, c.count]))
  return rows.map((s) => ({ ...s, agentCount: byId.get(s.id) ?? 0 }))
}
