import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolveChatwootWidgetForTeam } from "@/lib/chatwoot"
import { resolveTeamByHost } from "@/lib/tenant-branding"
import { getUserTeam } from "@/lib/team"

// Which Chatwoot the live-chat widget should load. Works for anonymous visitors
// too: on a tenant's custom domain the widget must be the TENANT's Chatwoot even
// before login, so we resolve by Host header when there's no session.
// Returns { widget: { baseUrl, websiteToken } | null }.
export async function GET(req: Request) {
  const session = await auth()

  let teamId: string | null = null
  if (session?.user?.id) {
    teamId = (await getUserTeam(session.user.id))?.teamId ?? null
  } else {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
    teamId = await resolveTeamByHost(host)
  }

  const widget = await resolveChatwootWidgetForTeam(teamId)
  return NextResponse.json({ widget })
}
