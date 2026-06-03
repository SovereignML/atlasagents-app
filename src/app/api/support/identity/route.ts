import { NextResponse } from "next/server"
import { auth } from "@/auth"
import {
  chatwootIdentifierHash,
  resolveChatwootForTeam,
  resolveChatwootWidgetForTeam,
} from "@/lib/chatwoot"
import { getUserTeam } from "@/lib/team"

// Drives the live-chat widget: which Chatwoot to load (tenant's or platform's)
// and the HMAC needed to verify the logged-in user. `hash` is null when no HMAC
// token is configured; `widget` is null when no Chatwoot is configured at all.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const teamId = (await getUserTeam(userId))?.teamId ?? null

  const [cfg, widget] = await Promise.all([
    resolveChatwootForTeam(teamId),
    resolveChatwootWidgetForTeam(teamId),
  ])

  return NextResponse.json({
    identifier: userId,
    hash: chatwootIdentifierHash(cfg, userId),
    widget, // { baseUrl, websiteToken } | null
  })
}
