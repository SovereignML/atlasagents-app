import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, driveConnections, eq } from "@/db"
import { BRANDING } from "@/configs/branding"
import { canManageTeam, getMembershipRole, getUserTeam } from "@/lib/team"
import { logAuditEvent } from "@/lib/audit"
import { encryptSecret } from "@/lib/crypto-secret"
import {
  isDriveConfigured,
  verifyDriveState,
  exchangeDriveCode,
  fetchGoogleEmail,
} from "@/lib/google-drive"

/**
 * GET /api/integrations/drive/callback
 *
 * Google's OAuth redirect target. Verifies the signed state, exchanges the
 * auth code for tokens, and persists the refresh token (encrypted). Redirects
 * back to the originating agent's Backup tab with a `?drive=...` status.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const code = params.get("code")
  const stateRaw = params.get("state")
  const oauthError = params.get("error")

  const state = verifyDriveState(stateRaw)

  // Where to send the user back to. Fall back to the dashboard root.
  const dest = (status: string) => {
    const base = state?.instanceId
      ? `${BRANDING.appUrl}/dashboard/instances/${state.instanceId}?tab=backup`
      : `${BRANDING.appUrl}/dashboard`
    const sep = base.includes("?") ? "&" : "?"
    return NextResponse.redirect(`${base}${sep}drive=${status}`)
  }

  if (!isDriveConfigured()) return dest("error")
  if (oauthError || !code) return dest("error")
  if (!state) return dest("error")

  // The signed state must belong to the currently authenticated user.
  const session = await auth()
  if (!session?.user?.id || session.user.id !== state.userId) {
    return dest("error")
  }

  // Resolve the target team. New consents carry it in the signed state; older
  // ones (minted before this field existed) fall back to the active team.
  let teamId = state.teamId
  if (!teamId) {
    const active = await getUserTeam(state.userId)
    teamId = active?.teamId
  }
  if (!teamId) return dest("error")

  // The connection is team-shared — the user must still be an owner/admin of it.
  const role = await getMembershipRole(state.userId, teamId)
  if (!canManageTeam(role)) return dest("error")

  try {
    const { refreshToken, accessToken, scope } = await exchangeDriveCode(code)

    // Google's granular consent lets the user grant `email`/`openid` but untick
    // the Drive permission — a token is still issued, so the connection would
    // look "Connected" yet every upload would 403. Reject up front instead.
    const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
    if (!scope?.split(" ").includes(DRIVE_FILE_SCOPE)) {
      return dest("noscope")
    }

    // Without a refresh token we can't mint future access tokens. prompt=consent
    // should always yield one; if it doesn't (and we have no prior connection),
    // ask the user to retry.
    const existing = await db.query.driveConnections.findFirst({
      where: eq(driveConnections.teamId, teamId),
    })
    if (!refreshToken && !existing) {
      return dest("norefresh")
    }

    const googleEmail = await fetchGoogleEmail(accessToken)

    if (existing) {
      await db
        .update(driveConnections)
        .set({
          ...(refreshToken ? { refreshTokenEnc: encryptSecret(refreshToken) } : {}),
          googleEmail: googleEmail ?? existing.googleEmail,
          scope,
          userId: state.userId,
        })
        .where(eq(driveConnections.teamId, teamId))
    } else {
      await db.insert(driveConnections).values({
        teamId,
        userId: state.userId,
        refreshTokenEnc: encryptSecret(refreshToken as string),
        googleEmail,
        scope,
      })
    }

    await logAuditEvent({
      userId: state.userId,
      teamId,
      action: "drive.connect",
      targetType: "drive_connection",
      targetLabel: googleEmail ?? undefined,
    })

    return dest("connected")
  } catch (err) {
    console.error("[drive] callback failed:", err instanceof Error ? err.message : err)
    return dest("error")
  }
}
