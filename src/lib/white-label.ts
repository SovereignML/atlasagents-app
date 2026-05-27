// White-label entitlement. The feature is gated on the team OWNER having an
// active scale/enterprise subscription. The check is intentionally cheap and
// called live on every branding read / domain action, so a downgrade reverts
// the look (and stops cert renewal) immediately without deleting stored config.

import { db, teams, subscriptions, eq, and, inArray } from "@/db"

/** Plan tiers that unlock white-label. Single source of truth. */
export const WHITE_LABEL_TIERS = ["scale", "enterprise"] as const

// Subscription.status values that count as "live". `stripe-events.ts` writes
// "active"/"past_due"/"canceled" plus, on update, the raw Stripe status (which
// can be "trialing"). We treat active + trialing as entitled.
const ACTIVE_STATUSES = ["active", "trialing"] as const

/** Whether a plan tier string unlocks white-label. */
export function tierHasWhiteLabel(tier: string | null | undefined): boolean {
  return tier === "scale" || tier === "enterprise"
}

/**
 * True when the team's owner has at least one active (or trialing) subscription
 * on a scale/enterprise plan. Robust to a user holding several subscriptions
 * (e.g. one per instance) — any qualifying one unlocks the team.
 */
export async function teamHasWhiteLabel(teamId: string): Promise<boolean> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { ownerId: true },
  })
  if (!team) return false

  const subs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.userId, team.ownerId),
      inArray(subscriptions.status, [...ACTIVE_STATUSES]),
    ),
    columns: {},
    with: { plan: { columns: { tier: true } } },
  })

  return subs.some((s) => tierHasWhiteLabel(s.plan?.tier))
}
