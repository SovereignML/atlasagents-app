import { db, botHosts, instances, eq, and, ne, isNotNull, sql } from "@/db"

export class FleetFullError extends Error {
  constructor() {
    super("All bot hosts are at capacity. Add a new host via `pnpm bootstrap:host`.")
    this.name = "FleetFullError"
  }
}

export class FleetEmptyError extends Error {
  constructor() {
    super("No ready BotHost rows exist. Run `pnpm bootstrap:host` to provision one.")
    this.name = "FleetEmptyError"
  }
}

export type PickedHost = {
  id: string
  ipAddress: string
  capacity: number
  runningCount: number
}

// Drizzle transaction handle type (matches the pattern used in wallet.ts).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Single fixed key for the fleet scheduler advisory lock. Any constant works;
// it just has to be the same everywhere so all reservations serialize against
// each other (and nothing else).
const SCHEDULER_LOCK_KEY = 0x50_56_53_31 // "PVS1"

const PORT_MIN = 4000
const PORT_MAX = 5999

/**
 * Pick the least-loaded "ready" BotHost using the given executor. Load = count
 * of Instances still bound to the host (status != deleted). Throws
 * FleetEmptyError if no hosts exist, FleetFullError if every host is full.
 */
async function pickHostTx(tx: Tx): Promise<PickedHost> {
  const hosts = await tx.query.botHosts.findMany({
    where: eq(botHosts.status, "ready"),
  })
  if (hosts.length === 0) {
    throw new FleetEmptyError()
  }

  const counts = await Promise.all(
    hosts.map(async (h) => {
      const rows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(instances)
        .where(and(eq(instances.botHostId, h.id), ne(instances.status, "deleted")))
      return { id: h.id, count: rows[0]?.count ?? 0 }
    }),
  )
  const countById = new Map(counts.map((c) => [c.id, c.count]))

  const ranked = hosts
    .map((h) => ({
      id: h.id,
      ipAddress: h.ipAddress,
      capacity: h.capacity,
      runningCount: countById.get(h.id) ?? 0,
    }))
    .filter((h) => h.runningCount < h.capacity)
    .sort((a, b) => a.runningCount - b.runningCount)

  if (ranked.length === 0) {
    throw new FleetFullError()
  }
  return ranked[0]
}

/** First free TCP port in [PORT_MIN, PORT_MAX] on the host, scanned via `tx`. */
async function allocatePortTx(tx: Tx, botHostId: string): Promise<number> {
  const used = await tx.query.instances.findMany({
    where: and(
      eq(instances.botHostId, botHostId),
      isNotNull(instances.containerPort),
      ne(instances.status, "deleted"),
    ),
    columns: { containerPort: true },
  })
  const taken = new Set(used.map((r) => r.containerPort).filter((p): p is number => typeof p === "number"))
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (!taken.has(port)) return port
  }
  throw new Error(`No free port in ${PORT_MIN}-${PORT_MAX} on host ${botHostId}`)
}

/**
 * Atomically reserve a host + container port for an instance.
 *
 * Pick-host, allocate-port and the persist of those onto the instance row all
 * happen inside one transaction holding a fleet-wide advisory lock, so two
 * concurrent deploys can never select the same `host:port` (the previous
 * read-scan-write `pickHost()`/`allocatePort()` pair raced: both saw the same
 * free port because neither persisted its choice before the other scanned).
 * The lock is blocking — concurrent deploys queue for a few ms rather than one
 * failing — and the port is written immediately so the next reservation sees it
 * as taken. Callers MUST clear `containerPort`/`botHostId` if provisioning then
 * fails, so a dead deploy doesn't hold a slot (see provisionSharedBot).
 */
export async function reserveHostSlot(
  instanceId: string,
): Promise<{ host: PickedHost; port: number }> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SCHEDULER_LOCK_KEY})`)
    const host = await pickHostTx(tx)
    const port = await allocatePortTx(tx, host.id)
    await tx
      .update(instances)
      .set({ botHostId: host.id, containerPort: port })
      .where(eq(instances.id, instanceId))
    return { host, port }
  })
}
