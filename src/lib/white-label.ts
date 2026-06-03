// White-label entitlement. The feature is gated on a single admin-controlled
// flag, `Team.whiteLabelEnabled`, which is the SOLE source of truth. A platform
// admin flips it from /admin/teams (see src/app/api/admin/teams). Subscription
// tier no longer auto-grants — the migration that introduced the flag backfilled
// it for teams that held an active enterprise subscription at the time. The check
// is intentionally cheap and called live on every branding read / domain action,
// so revoking the flag reverts the look (and stops cert renewal) immediately
// without deleting stored config.

import { db, teams, eq } from "@/db"

/** Plan tiers historically associated with white-label. Kept for pricing copy
 *  and the one-time backfill; no longer used to gate access at runtime. */
export const WHITE_LABEL_TIERS = ["enterprise"] as const

/** Whether a plan tier string is the white-label tier (pricing copy only). */
export function tierHasWhiteLabel(tier: string | null | undefined): boolean {
  return tier === "enterprise"
}

/**
 * True when an admin has enabled white-label for the team. Single source of
 * truth — see `Team.whiteLabelEnabled` and the /admin/teams toggle.
 */
export async function teamHasWhiteLabel(teamId: string): Promise<boolean> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { whiteLabelEnabled: true },
  })
  return team?.whiteLabelEnabled ?? false
}
