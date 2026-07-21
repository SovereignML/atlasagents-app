// Reseller tenancy helpers (Node runtime — imports @/db).
//
// A white-label "tenant" is an enterprise team. Its end-customers are child
// teams: ordinary `teams` rows with `parentTeamId` pointing at the tenant. This
// reuses the entire team-scoped stack (instances, branding, providers, ACL) —
// a child team is just a team. See src/db/schema.ts (`teams.parentTeamId`,
// `tenantConfig`) and the plan at ~/.claude/plans/structured-growing-valley.md.

import { db, teams, memberships, tenantConfig, eq, and, sql } from "@/db"
import type { InferSelectModel } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { decryptSecret } from "./crypto-secret"

export type Team = InferSelectModel<typeof teams>
export type TenantConfig = InferSelectModel<typeof tenantConfig>

/** Fetch a team row, or null. */
export async function getTeam(teamId: string): Promise<Team | null> {
  return (await db.query.teams.findFirst({ where: eq(teams.id, teamId) })) ?? null
}

/**
 * The tenant a team belongs to: its `parentTeamId` if it's a child, otherwise
 * the team's own id (a top-level team is its own tenant for config purposes).
 * Returns null only when the team doesn't exist. Callers gate on
 * `getTenantConfig` to distinguish a real reseller tenant from a plain team.
 */
export async function getTenantForTeam(teamId: string): Promise<string | null> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { id: true, parentTeamId: true },
  })
  if (!team) return null
  return team.parentTeamId ?? team.id
}

/** All child end-customer teams under a tenant (newest first). */
export async function listChildTeams(parentTeamId: string): Promise<Team[]> {
  return db.query.teams.findMany({
    where: eq(teams.parentTeamId, parentTeamId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  })
}

/** True when `childTeamId` is a direct child of `parentTeamId`. */
export async function isChildOf(
  childTeamId: string,
  parentTeamId: string,
): Promise<boolean> {
  const row = await db.query.teams.findFirst({
    where: and(eq(teams.id, childTeamId), eq(teams.parentTeamId, parentTeamId)),
    columns: { id: true },
  })
  return Boolean(row)
}

/**
 * True when `userId` is a tenant MANAGER (owner or admin) of the white-label
 * parent tenant that `childTeamId` belongs to. This is the membership-based
 * scope check the reseller stack should use — the older `isUserInTenantScopeOf`
 * / god-view keyed on the tenant's OWNER only, so a non-owner tenant admin (whom
 * `requireTenantAdmin` already admits) saw nothing. Gates act-as-team honoring
 * and the instance god-view.
 */
export async function isTenantManagerOverChild(
  userId: string,
  childTeamId: string,
): Promise<boolean> {
  const child = await db.query.teams.findFirst({
    where: eq(teams.id, childTeamId),
    columns: { parentTeamId: true },
  })
  if (!child?.parentTeamId) return false

  const parent = await db.query.teams.findFirst({
    where: eq(teams.id, child.parentTeamId),
    columns: { id: true, whiteLabelEnabled: true },
  })
  if (!parent?.whiteLabelEnabled) return false

  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, parent.id), eq(memberships.userId, userId)),
    columns: { role: true },
  })
  return membership?.role === "owner" || membership?.role === "admin"
}

/** The reseller config row for a tenant team, or null if it isn't a tenant. */
export async function getTenantConfig(
  parentTeamId: string,
): Promise<TenantConfig | null> {
  return (
    (await db.query.tenantConfig.findFirst({
      where: eq(tenantConfig.teamId, parentTeamId),
    })) ?? null
  )
}

/** True when `teamId` is a reseller tenant (has a tenantConfig row). */
export async function isTenant(teamId: string): Promise<boolean> {
  return Boolean(await getTenantConfig(teamId))
}

/**
 * True when `teamId` is a CHILD end-customer team of a reseller tenant (its
 * `parentTeamId` points at a team that has a `tenantConfig`). Such teams MUST
 * mint their agents' LLM keys against the tenant's own OpenRouter account — if
 * the tenant hasn't configured one, the deploy fails closed rather than silently
 * billing the platform. See getOrMintInstanceOpenRouterKey.
 */
export async function isResellerChildTeam(teamId: string): Promise<boolean> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { parentTeamId: true },
  })
  if (!team?.parentTeamId) return false
  return Boolean(await getTenantConfig(team.parentTeamId))
}

/**
 * Create a brand-new child end-customer team under `parentTeamId`, owned by
 * `ownerUserId` (with the owner membership). Mirrors `createTeam` in
 * src/lib/team.ts but stamps the parent + per-customer limits. The caller is
 * responsible for setting the owner's `activeTeamId` if desired.
 */
export async function createChildTeam(args: {
  parentTeamId: string
  name: string
  ownerUserId: string
  agentLimit?: number | null
  seatLimit?: number | null
}): Promise<Team> {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({
        id: createId(),
        name: args.name,
        ownerId: args.ownerUserId,
        parentTeamId: args.parentTeamId,
        ...(args.agentLimit != null ? { agentLimit: args.agentLimit } : {}),
        ...(args.seatLimit != null ? { seatLimit: args.seatLimit } : {}),
      })
      .returning()
    await tx
      .insert(memberships)
      .values({ teamId: team.id, userId: args.ownerUserId, role: "owner" })
      .onConflictDoNothing()
    return team
  })
}

/**
 * True when `targetUserId` is a member of a child end-customer team whose parent
 * tenant is owned by `ownerUserId`. Used to re-verify tenant-admin impersonation
 * scope on every request (the impersonation cookie is only a userId).
 */
export async function isUserInTenantScopeOf(
  ownerUserId: string,
  targetUserId: string,
): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1
    FROM "Membership" m
    JOIN "Team" child ON child.id = m."teamId"
    JOIN "Team" parent ON parent.id = child."parentTeamId"
    WHERE m."userId" = ${targetUserId} AND parent."ownerId" = ${ownerUserId}
    LIMIT 1
  `)
  return (res.rowCount ?? 0) > 0
}

/**
 * The tenant's own OpenRouter provisioning key for a team (decrypted), or null
 * when the team isn't under a tenant that brought their own OpenRouter account.
 * Used so child-org agent runtime keys are minted against the TENANT's account.
 */
export async function getTenantOpenRouterKey(teamId: string): Promise<string | null> {
  const tenantId = await getTenantForTeam(teamId)
  if (!tenantId) return null
  const cfg = await getTenantConfig(tenantId)
  return cfg?.openRouterProvisioningKeyEnc
    ? decryptSecret(cfg.openRouterProvisioningKeyEnc)
    : null
}

/**
 * True when a team is blocked from operating — either it was suspended directly
 * by its tenant admin (`suspendedAt`), OR it is a child end-customer whose
 * reseller tenant is itself suspended or has lost white-label entitlement. The
 * cascade means revoking/suspending a whole reseller instantly stops every one
 * of its child customers, without having to flag each child row individually.
 */
export async function isTeamSuspended(teamId: string): Promise<boolean> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { suspendedAt: true, parentTeamId: true },
  })
  if (!team) return false
  if (team.suspendedAt) return true
  if (team.parentTeamId) {
    const parent = await db.query.teams.findFirst({
      where: eq(teams.id, team.parentTeamId),
      columns: { suspendedAt: true, whiteLabelEnabled: true },
    })
    if (parent && (parent.suspendedAt || !parent.whiteLabelEnabled)) return true
  }
  return false
}
