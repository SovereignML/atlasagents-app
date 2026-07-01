// Free-tier (demo agent) policy + usage accounting.
//
// Two independent limits are enforced everywhere a free agent is created
// (the deploy route + the backup-restore route), driven off the same usage
// snapshot:
//
//   1. Concurrency — at most ONE live free agent per runtime. A user may run
//      one free OpenClaw AND one free Hermes simultaneously, but not two of
//      the same runtime.
//   2. Lifetime — a user may ever deploy at most FREE_LIFETIME_LIMIT free
//      agents. Once that allowance is spent the Free plan is removed for them
//      (hidden in the deploy UI, rejected by the API).
//
// A non-null `instances.expiresAt` is the canonical "this is a free/demo
// agent" signal (see FREE_DEMO_TTL_MS in configs/plans.ts). Demo rows are not
// hard-deleted on teardown — the reaper transitions them to `deleted` — so the
// row count is an accurate lifetime total, while the live-status filter gives
// the current concurrency picture.

import { db, instances, eq, and, isNotNull } from "@/db"

/** Max number of free-tier (demo) agents a single user may ever deploy. */
export const FREE_LIFETIME_LIMIT = 3

export type FreeRuntime = "openclaw" | "hermes"

export type FreeTierUsage = {
  /** Free agents this user has ever deployed (any status, including deleted). */
  lifetimeCount: number
  /** True once the lifetime allowance is fully spent. */
  exhausted: boolean
  /** Runtimes that currently have a live (non-torn-down) free agent. */
  activeRuntimes: FreeRuntime[]
}

const DEAD_STATUSES = new Set(["deleting", "deleted"])

function normalizeRuntime(runtime: string | null): FreeRuntime {
  return runtime === "hermes" ? "hermes" : "openclaw"
}

/** Snapshot of a user's free-tier usage, used to gate new free deployments. */
export async function getFreeTierUsage(userId: string): Promise<FreeTierUsage> {
  const rows = await db.query.instances.findMany({
    where: and(eq(instances.userId, userId), isNotNull(instances.expiresAt)),
    columns: { runtime: true, status: true },
  })

  const activeRuntimes = Array.from(
    new Set(
      rows
        .filter((r) => !DEAD_STATUSES.has(r.status))
        .map((r) => normalizeRuntime(r.runtime)),
    ),
  )

  return {
    lifetimeCount: rows.length,
    exhausted: rows.length >= FREE_LIFETIME_LIMIT,
    activeRuntimes,
  }
}

/**
 * Decide whether `userId` may deploy a new free agent on `runtime`. Returns a
 * 4xx error payload (with a stable `code`) when blocked, or `null` to allow.
 * Shared by the deploy route and the restore route so the two stay in lockstep.
 */
export function checkFreeDeployAllowed(
  usage: FreeTierUsage,
  runtime: FreeRuntime,
): { status: number; body: { error: string; code: string } } | null {
  if (usage.exhausted) {
    return {
      status: 403,
      body: {
        error: `You've used all ${FREE_LIFETIME_LIMIT} free agents. Upgrade to deploy more.`,
        code: "free_lifetime",
      },
    }
  }
  if (usage.activeRuntimes.includes(runtime)) {
    const label = runtime === "hermes" ? "Hermes" : "OpenClaw"
    return {
      status: 409,
      body: {
        error: `You already have a free ${label} agent running. Wait for it to expire or upgrade to deploy more.`,
        code: "free_runtime_active",
      },
    }
  }
  return null
}
