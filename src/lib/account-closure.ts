import {
  db,
  users,
  accounts,
  sessions,
  instances,
  subscriptions,
  teams,
  memberships,
  verificationTokens,
  notificationPreferences,
  and,
  eq,
  ne,
  notInArray,
  inArray,
  sql,
} from "@/db"

/**
 * Close a user's account without deleting its money trail.
 *
 * Deleting the User row used to cascade to their wallet, wallet transactions,
 * credit ledger, subscriptions, usage and their own audit trail, and to their
 * agents' rows while the VMs kept running. Accounting, chargebacks and abuse
 * investigations all need those records, and the money-trail foreign keys are
 * now `restrict`, so a hard delete fails rather than erasing them.
 *
 * Closing instead:
 *  - refuses while the user still has agents, a subscription Stripe may still
 *    bill, or a team other people belong to (those need a decision first);
 *  - anonymizes the personal fields on the row and sets `deletedAt`;
 *  - removes sign-in (password, OAuth links, sessions, 2FA, pending tokens)
 *    and their memberships in other people's teams.
 * Open sessions end on the next request (src/lib/account-status.ts treats a
 * closed account as gone).
 */

export type ClosureResult = { ok: true } | { ok: false; status: number; error: string }

const LIVE_INSTANCE_EXCLUDED = ["deleted"]
const ENDED_SUBSCRIPTION = ["canceled", "incomplete_expired"]

/** The address a closed account's row carries. Unique, and never deliverable. */
export function closedAccountEmail(userId: string): string {
  return `deleted+${userId}@deleted.invalid`
}

export async function closeUserAccount(userId: string): Promise<ClosureResult> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, deletedAt: true },
  })
  if (!user) return { ok: false, status: 404, error: "User not found" }
  if (user.deletedAt) return { ok: false, status: 409, error: "This account is already closed." }

  const liveAgent = await db.query.instances.findFirst({
    where: and(eq(instances.userId, userId), notInArray(instances.status, LIVE_INSTANCE_EXCLUDED)),
    columns: { id: true },
  })
  if (liveAgent) {
    return {
      ok: false,
      status: 409,
      error: "The user still has agents. Delete them first, so their servers are released.",
    }
  }

  const liveSubscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      notInArray(subscriptions.status, ENDED_SUBSCRIPTION),
    ),
    columns: { id: true },
  })
  if (liveSubscription) {
    return {
      ok: false,
      status: 409,
      error: "The user has a subscription that may still bill. Cancel it first.",
    }
  }

  const sharedTeam = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(memberships, eq(memberships.teamId, teams.id))
    .where(and(eq(teams.ownerId, userId), ne(memberships.userId, userId)))
    .limit(1)
  if (sharedTeam.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "The user owns a team other people belong to. Transfer or delete it first.",
    }
  }

  await db.transaction(async (tx) => {
    const ownedTeamIds = (
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.ownerId, userId))
    ).map((t) => t.id)

    await tx
      .update(users)
      .set({
        deletedAt: new Date(),
        email: closedAccountEmail(userId),
        name: null,
        image: null,
        hashedPassword: null,
        emailVerified: null,
        telegramId: null,
        twitterHandle: null,
        discordId: null,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        twoFactorBackupCodes: null,
        twoFactorEnrolledAt: null,
        fbclid: null,
        gclid: null,
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: "account closed",
      })
      .where(eq(users.id, userId))
    await tx.delete(accounts).where(eq(accounts.userId, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    // Password-reset tokens are keyed by the lowercased email, verification
    // tokens by "email-verify:<email>" (src/lib/email-verification.ts).
    const email = user.email.toLowerCase()
    await tx
      .delete(verificationTokens)
      .where(inArray(verificationTokens.identifier, [email, `email-verify:${email}`]))
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId))
    // Memberships in other people's teams go; their own (now member-less)
    // teams stay, since subscriptions and audit rows may point at them.
    await tx
      .delete(memberships)
      .where(
        ownedTeamIds.length > 0
          ? and(eq(memberships.userId, userId), sql`not (${inArray(memberships.teamId, ownedTeamIds)})`)
          : eq(memberships.userId, userId),
      )
  })

  return { ok: true }
}
