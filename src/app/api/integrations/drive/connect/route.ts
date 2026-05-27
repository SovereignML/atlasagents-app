import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
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

  const instanceId = req.nextUrl.searchParams.get("instanceId") ?? undefined
  const state = signDriveState({ userId: session.user.id, instanceId })
  return NextResponse.json({ url: buildDriveConsentUrl(state) })
}
