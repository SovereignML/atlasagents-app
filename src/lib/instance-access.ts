// Per-agent access control (the ACL). An agent (instance) is owned by its
// creator and belongs to a team. Access for OTHER members is governed by
// `InstanceAccess` grants at one of three levels:
//
//   viewer   — read-only (status, logs)
//   operator — viewer + operate (restart, backup, bind domain, connect iface)
//   manager  — operator + edit config + re-share / revoke access
//
// The agent creator and the team owner always have effective level "manager".
// Only owner-like actors (creator/team-owner) may mint `manager` grants;
// a granted manager may re-share at viewer/operator only. A granted manager
// may revoke only grants they created; owner-like actors may revoke any.
import { createId } from "@paralleldrive/cuid2"
import {
  db,
  and,
  eq,
  instances,
  instanceAccess,
  memberships,
  teams,
} from "@/db"
import { logAuditEvent } from "@/lib/audit"

export const ACCESS_LEVELS = ["viewer", "operator", "manager"] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

const LEVEL_RANK: Record<AccessLevel, number> = { viewer: 1, operator: 2, manager: 3 }

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v)
}

/** True when `level` exists and ranks at or above `min`. */
export function levelAtLeast(level: AccessLevel | null | undefined, min: AccessLevel): boolean {
  return level != null && LEVEL_RANK[level] >= LEVEL_RANK[min]
}

export type InstanceAccessInfo = {
  /** Whether the user can see the agent at all. */
  canSee: boolean
  /** Effective level: "manager" for creator/team-owner, else the grant level. */
  level: AccessLevel | null
  isCreator: boolean
  isTeamOwner: boolean
  /** Creator or team-owner — the only actors who may mint manager grants. */
  isOwnerLike: boolean
  teamId: string | null
}

const NONE: InstanceAccessInfo = {
  canSee: false,
  level: null,
  isCreator: false,
  isTeamOwner: false,
  isOwnerLike: false,
  teamId: null,
}

/** Resolve a user's effective access to a single agent. */
export async function getInstanceAccessLevel(
  userId: string,
  instanceId: string,
): Promise<InstanceAccessInfo> {
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { id: true, userId: true, teamId: true },
  })
  if (!inst) return NONE

  const isCreator = inst.userId === userId
  let isTeamOwner = false
  if (inst.teamId) {
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, inst.teamId),
      columns: { ownerId: true },
    })
    isTeamOwner = team?.ownerId === userId
  }

  if (isCreator || isTeamOwner) {
    return {
      canSee: true,
      level: "manager",
      isCreator,
      isTeamOwner,
      isOwnerLike: true,
      teamId: inst.teamId,
    }
  }

  const grant = await db.query.instanceAccess.findFirst({
    where: and(eq(instanceAccess.instanceId, instanceId), eq(instanceAccess.userId, userId)),
    columns: { level: true },
  })
  if (grant && isAccessLevel(grant.level)) {
    return {
      canSee: true,
      level: grant.level,
      isCreator: false,
      isTeamOwner: false,
      isOwnerLike: false,
      teamId: inst.teamId,
    }
  }
  return { ...NONE, teamId: inst.teamId }
}

export async function canViewInstance(userId: string, instanceId: string): Promise<boolean> {
  return (await getInstanceAccessLevel(userId, instanceId)).canSee
}

export async function canOperateInstance(userId: string, instanceId: string): Promise<boolean> {
  return levelAtLeast((await getInstanceAccessLevel(userId, instanceId)).level, "operator")
}

export async function canManageInstanceAccess(
  userId: string,
  instanceId: string,
): Promise<boolean> {
  return levelAtLeast((await getInstanceAccessLevel(userId, instanceId)).level, "manager")
}

export type AccessResult = { ok: true } | { ok: false; error: string; status: number }

/** Highest level `actor` is allowed to grant. Only owner-like may mint managers. */
function maxGrantableLevel(actor: InstanceAccessInfo): AccessLevel | null {
  if (!levelAtLeast(actor.level, "manager")) return null
  return actor.isOwnerLike ? "manager" : "operator"
}

/**
 * Grant or update a member's access to an agent. Validates the actor is a
 * manager, the requested level is within their grantable ceiling, and the
 * grantee is a member of the agent's team. Upserts on (instanceId, userId).
 */
export async function setInstanceAccess(params: {
  instanceId: string
  granteeUserId: string
  level: AccessLevel
  actorUserId: string
  /** "grant" (POST) vs "update" (PATCH) — only affects the audit action. */
  mode: "grant" | "update"
}): Promise<AccessResult> {
  const { instanceId, granteeUserId, level, actorUserId, mode } = params

  if (!isAccessLevel(level)) return { ok: false, error: "Invalid access level", status: 400 }

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { id: true, userId: true, teamId: true },
  })
  if (!inst || !inst.teamId) return { ok: false, error: "Agent not found", status: 404 }

  const actor = await getInstanceAccessLevel(actorUserId, instanceId)
  const ceiling = maxGrantableLevel(actor)
  if (!ceiling) return { ok: false, error: "You cannot manage access for this agent", status: 403 }
  if (LEVEL_RANK[level] > LEVEL_RANK[ceiling]) {
    return { ok: false, error: "You cannot grant a level above your own", status: 403 }
  }

  if (granteeUserId === inst.userId) {
    return { ok: false, error: "The agent owner already has full access", status: 400 }
  }

  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, inst.teamId), eq(memberships.userId, granteeUserId)),
    columns: { userId: true },
  })
  if (!membership) {
    return { ok: false, error: "User is not a member of this team", status: 400 }
  }

  await db
    .insert(instanceAccess)
    .values({ id: createId(), instanceId, userId: granteeUserId, level, grantedById: actorUserId })
    .onConflictDoUpdate({
      target: [instanceAccess.instanceId, instanceAccess.userId],
      set: { level, grantedById: actorUserId },
    })

  await logAuditEvent({
    userId: actorUserId,
    teamId: inst.teamId,
    action: mode === "update" ? "instance.access.update" : "instance.access.grant",
    targetType: "instance",
    targetId: instanceId,
    meta: { granteeUserId, level },
  })
  return { ok: true }
}

/**
 * Revoke a member's access. Owner-like actors may revoke any grant; a granted
 * manager may revoke only grants they themselves created.
 */
export async function revokeInstanceAccess(params: {
  instanceId: string
  granteeUserId: string
  actorUserId: string
}): Promise<AccessResult> {
  const { instanceId, granteeUserId, actorUserId } = params

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { id: true, teamId: true },
  })
  if (!inst) return { ok: false, error: "Agent not found", status: 404 }

  const actor = await getInstanceAccessLevel(actorUserId, instanceId)
  if (!levelAtLeast(actor.level, "manager")) {
    return { ok: false, error: "You cannot manage access for this agent", status: 403 }
  }

  const existing = await db.query.instanceAccess.findFirst({
    where: and(eq(instanceAccess.instanceId, instanceId), eq(instanceAccess.userId, granteeUserId)),
    columns: { grantedById: true },
  })
  if (!existing) return { ok: true } // idempotent

  if (!actor.isOwnerLike && existing.grantedById !== actorUserId) {
    return { ok: false, error: "You can only revoke grants you created", status: 403 }
  }

  await db
    .delete(instanceAccess)
    .where(and(eq(instanceAccess.instanceId, instanceId), eq(instanceAccess.userId, granteeUserId)))

  await logAuditEvent({
    userId: actorUserId,
    teamId: inst.teamId,
    action: "instance.access.revoke",
    targetType: "instance",
    targetId: instanceId,
    meta: { granteeUserId },
  })
  return { ok: true }
}

export type AccessGrantView = {
  userId: string
  name: string | null
  email: string
  level: AccessLevel
  grantedById: string
  createdAt: string
}

/** List the current per-agent grants (for the Access UI). */
export async function listInstanceAccess(instanceId: string): Promise<AccessGrantView[]> {
  const rows = await db.query.instanceAccess.findMany({
    where: eq(instanceAccess.instanceId, instanceId),
    with: { user: { columns: { id: true, name: true, email: true } } },
  })
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user?.name ?? null,
    email: r.user?.email ?? "",
    level: (isAccessLevel(r.level) ? r.level : "viewer") as AccessLevel,
    grantedById: r.grantedById,
    createdAt: r.createdAt.toISOString(),
  }))
}
