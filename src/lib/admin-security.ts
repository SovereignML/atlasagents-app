// Security posture for the admin console's Security tab.
//
// The question this answers: WHO on this platform is exploitable right now, and
// which of them would hurt most. It is a read-time snapshot from `User`,
// `Account` and `Session` — there is no stored risk score and no history.
//
// The central distinction, and the reason a naive "users without 2FA" count is
// misleading: a user whose ONLY credential is a federated identity (Google /
// Apple / X, i.e. `hashedPassword IS NULL` with an OAuth Account row) has their
// second factor enforced by that provider, not by us. Counting them as
// "unprotected" buries the people who actually are — password holders with no
// TOTP, who can be credential-stuffed directly against our login form.
//
// Companion: src/lib/admin-metrics.ts (growth/fleet), src/lib/admin-accounts.ts
// (account health).

import { db, sql } from "@/db"

export type RiskLevel = "critical" | "high" | "medium" | "low"

export type SecurityCounts = {
  totalUsers: number
  /** Password holders (hashedPassword set) — the population 2FA actually protects. */
  passwordUsers: number
  /** Password holders WITH TOTP enrolled. */
  twoFactorEnabled: number
  /** Password holders WITHOUT TOTP — directly credential-stuffable. */
  passwordNoTwoFactor: number
  /** OAuth-only: no local password, second factor delegated to the provider. */
  oauthOnly: number
  /** Admins with no TOTP. The blast-radius number — should be zero. */
  adminsNoTwoFactor: number
  totalAdmins: number
  /** Enrolled in TOTP but holding no unused backup codes — a lockout risk. */
  twoFactorNoBackupCodes: number
  unverifiedEmail: number
  bannedUsers: number
  /** Users with no TOTP who currently hold a live session. */
  exposedLiveSessions: number
  /** 2FA coverage across password holders, 0–100. */
  coveragePct: number
}

export type VulnerableUser = {
  id: string
  name: string | null
  email: string
  role: string
  risk: RiskLevel
  reasons: string[]
  createdAt: Date
  lastSessionExpires: Date | null
}

/**
 * Headline counts. One pass over User with a correlated Account/Session probe;
 * `hasPassword` and `isOauthOnly` are computed in SQL so the buckets here and
 * the per-user rows below can never drift apart.
 */
export async function getSecurityCounts(): Promise<SecurityCounts> {
  const res = await db.execute(sql`
    WITH u AS (
      SELECT
        us.id,
        us.role,
        us."isBanned",
        us."emailVerified",
        us."twoFactorEnabled",
        us."twoFactorBackupCodes",
        (us."hashedPassword" IS NOT NULL)                            AS has_password,
        EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = us.id)  AS has_oauth,
        EXISTS (
          SELECT 1 FROM "Session" s
          WHERE s."userId" = us.id AND s.expires > now()
        )                                                            AS has_live_session
      FROM "User" us
    )
    SELECT
      count(*)::int                                                                     AS total_users,
      count(*) FILTER (WHERE has_password)::int                                         AS password_users,
      count(*) FILTER (WHERE has_password AND "twoFactorEnabled")::int                  AS two_factor_enabled,
      count(*) FILTER (WHERE has_password AND NOT "twoFactorEnabled")::int              AS password_no_2fa,
      count(*) FILTER (WHERE NOT has_password AND has_oauth)::int                       AS oauth_only,
      count(*) FILTER (WHERE role = 'admin')::int                                       AS total_admins,
      count(*) FILTER (WHERE role = 'admin' AND NOT "twoFactorEnabled")::int            AS admins_no_2fa,
      -- jsonb_array_length() ERRORS on a non-array value rather than returning
      -- null, so a single malformed row would 500 the entire tab. Gate on
      -- jsonb_typeof and treat anything that is not an array as "no codes".
      count(*) FILTER (
        WHERE "twoFactorEnabled"
          AND CASE
                WHEN jsonb_typeof("twoFactorBackupCodes") = 'array'
                THEN jsonb_array_length("twoFactorBackupCodes")
                ELSE 0
              END = 0
      )::int                                                                            AS two_factor_no_backup,
      count(*) FILTER (WHERE "emailVerified" IS NULL)::int                              AS unverified_email,
      count(*) FILTER (WHERE "isBanned")::int                                           AS banned_users,
      count(*) FILTER (WHERE NOT "twoFactorEnabled" AND has_live_session)::int          AS exposed_live_sessions
    FROM u
  `)

  const r = (res.rows[0] ?? {}) as Record<string, number>
  const passwordUsers = Number(r.password_users ?? 0)
  const twoFactorEnabled = Number(r.two_factor_enabled ?? 0)

  return {
    totalUsers: Number(r.total_users ?? 0),
    passwordUsers,
    twoFactorEnabled,
    passwordNoTwoFactor: Number(r.password_no_2fa ?? 0),
    oauthOnly: Number(r.oauth_only ?? 0),
    adminsNoTwoFactor: Number(r.admins_no_2fa ?? 0),
    totalAdmins: Number(r.total_admins ?? 0),
    twoFactorNoBackupCodes: Number(r.two_factor_no_backup ?? 0),
    unverifiedEmail: Number(r.unverified_email ?? 0),
    bannedUsers: Number(r.banned_users ?? 0),
    exposedLiveSessions: Number(r.exposed_live_sessions ?? 0),
    // Denominator is password holders, not all users: OAuth-only accounts
    // cannot enrol local TOTP, so including them would permanently cap the
    // number below 100% and make a fully-protected platform look negligent.
    coveragePct: passwordUsers === 0 ? 100 : Math.round((twoFactorEnabled / passwordUsers) * 100),
  }
}

/**
 * The people to actually go chase, worst first.
 *
 * Ranking is by blast radius, not by count of flags: an admin without 2FA
 * outranks any number of unverified end users, because the admin console can
 * impersonate, ban, refund and delete.
 */
export async function getVulnerableUsers(limit = 100): Promise<VulnerableUser[]> {
  const res = await db.execute(sql`
    WITH u AS (
      SELECT
        us.id, us.name, us.email, us.role, us."createdAt",
        us."isBanned", us."emailVerified", us."twoFactorEnabled",
        us."twoFactorBackupCodes",
        (us."hashedPassword" IS NOT NULL)                            AS has_password,
        EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = us.id)  AS has_oauth,
        (SELECT max(s.expires) FROM "Session" s
          WHERE s."userId" = us.id AND s.expires > now())            AS last_session_expires,
        -- See getSecurityCounts: jsonb_array_length() errors on a non-array,
        -- so normalise once here and use the derived column below.
        CASE
          WHEN jsonb_typeof(us."twoFactorBackupCodes") = 'array'
          THEN jsonb_array_length(us."twoFactorBackupCodes")
          ELSE 0
        END                                                          AS backup_codes_left
      FROM "User" us
      WHERE us."isBanned" = false
    )
    SELECT *,
      CASE
        WHEN role = 'admin' AND NOT "twoFactorEnabled"                     THEN 'critical'
        WHEN has_password AND NOT "twoFactorEnabled"
             AND last_session_expires IS NOT NULL                          THEN 'high'
        WHEN has_password AND NOT "twoFactorEnabled"                       THEN 'medium'
        WHEN "twoFactorEnabled" AND backup_codes_left = 0                  THEN 'low'
        WHEN "emailVerified" IS NULL                                       THEN 'low'
        ELSE NULL
      END AS risk
    FROM u
    WHERE
      (role = 'admin' AND NOT "twoFactorEnabled")
      OR (has_password AND NOT "twoFactorEnabled")
      OR ("twoFactorEnabled" AND backup_codes_left = 0)
      OR "emailVerified" IS NULL
    ORDER BY
      CASE
        WHEN role = 'admin' AND NOT "twoFactorEnabled" THEN 0
        WHEN has_password AND NOT "twoFactorEnabled"
             AND last_session_expires IS NOT NULL      THEN 1
        WHEN has_password AND NOT "twoFactorEnabled"   THEN 2
        ELSE 3
      END,
      "createdAt" DESC
    LIMIT ${limit}
  `)

  type Row = {
    id: string
    name: string | null
    email: string
    role: string
    createdAt: Date
    emailVerified: Date | null
    twoFactorEnabled: boolean
    backup_codes_left: number
    has_password: boolean
    has_oauth: boolean
    last_session_expires: Date | null
    risk: RiskLevel | null
  }

  return (res.rows as Row[]).map((r) => {
    const reasons: string[] = []
    if (r.role === "admin" && !r.twoFactorEnabled) reasons.push("Admin without 2FA")
    if (r.has_password && !r.twoFactorEnabled) reasons.push("Password login, no 2FA")
    if (!r.has_password && r.has_oauth) reasons.push("OAuth-only (2FA delegated to provider)")
    if (r.twoFactorEnabled && Number(r.backup_codes_left ?? 0) === 0) {
      reasons.push("2FA on, no backup codes left")
    }
    if (r.emailVerified == null) reasons.push("Email never verified")
    if (r.last_session_expires) reasons.push("Has a live session")

    return {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      risk: r.risk ?? "low",
      reasons,
      createdAt: new Date(r.createdAt),
      lastSessionExpires: r.last_session_expires ? new Date(r.last_session_expires) : null,
    }
  })
}

export async function getSecurityPosture(): Promise<{
  counts: SecurityCounts | undefined
  users: VulnerableUser[]
  failed: boolean
}> {
  try {
    const [counts, users] = await Promise.all([getSecurityCounts(), getVulnerableUsers()])
    return { counts, users, failed: false }
  } catch (err) {
    console.error("[admin-security] posture query failed:", err)
    return { counts: undefined, users: [], failed: true }
  }
}
