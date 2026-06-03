import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireTeamManage } from "@/lib/team"
import { isDriveConfigured, buildDriveConsentUrl, signDriveState } from "@/lib/google-drive"

/**
 * GET /api/integrations/drive/connect?instanceId=<id>
 *
 * Starts the per-user Google Drive OAuth consent flow. Returns the consent URL
 * for the client to navigate to. `instanceId` (optional) is carried through the
 * signed state so the callback can redirect back to that agent's Backup tab.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isDriveConfigured()) {
    return NextResponse.json(
      { error: "Google Drive integration is not configured" },
      { status: 503 },
    )
  }

  // The Drive connection is shared across the team — only owners/admins connect it.
  const team = await requireTeamManage(session.user.id)
  if (!team) {
    return NextResponse.json(
      { error: "Only team owners and admins can connect a backup provider" },
      { status: 403 },
    )
  }

  const instanceId = req.nextUrl.searchParams.get("instanceId") ?? undefined
  const state = signDriveState({ userId: session.user.id, teamId: team.teamId, instanceId })
  return NextResponse.json({ url: buildDriveConsentUrl(state) })
}
