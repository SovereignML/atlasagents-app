// Which dashboard origins may frame an agent's AgentWebUI Lite chat page
// (Lite's FRAME_ANCESTORS). Kept out of runtimes/agentwebui-lite.ts because it
// reads the database, and the runtimes stay pure for the unit tests.

import { db, teamBranding, eq, and } from "@/db"
import { BRANDING } from "@/configs/branding"

/** The canonical dashboard, plus the team's white-label domain once its certificate is issued. */
export async function chatUiFrameAncestors(teamId: string | null | undefined): Promise<string[]> {
  const origins = new Set<string>()
  try {
    origins.add(new URL(BRANDING.appUrl).origin)
  } catch {
    // A malformed NEXT_PUBLIC_APP_URL leaves only the team domain (or nothing,
    // in which case Lite lets only itself frame the page).
  }
  if (teamId) {
    const row = await db.query.teamBranding.findFirst({
      where: and(eq(teamBranding.teamId, teamId), eq(teamBranding.tlsStatus, "issued")),
      columns: { customDomain: true },
    })
    if (row?.customDomain) origins.add(`https://${row.customDomain}`)
  }
  return [...origins]
}
