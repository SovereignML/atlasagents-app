import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, driveConnections, eq } from "@/db"
import { BRANDING } from "@/configs/branding"
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

  try {
    const { refreshToken, accessToken } = await exchangeDriveCode(code)

    // Without a refresh token we can't mint future access tokens. prompt=consent
    // should always yield one; if it doesn't (and we have no prior connection),
    // ask the user to retry.
    const existing = await db.query.driveConnections.findFirst({
      where: eq(driveConnections.userId, state.userId),
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
        })
        .where(eq(driveConnections.userId, state.userId))
    } else {
      await db.insert(driveConnections).values({
        userId: state.userId,
        refreshTokenEnc: encryptSecret(refreshToken as string),
        googleEmail,
        scope: "https://www.googleapis.com/auth/drive.file",
      })
    }

    await logAuditEvent({
      userId: state.userId,
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
