// Which dashboard origins may frame an agent's AgentWebUI Lite chat page
// (Lite's FRAME_ANCESTORS), and the secret the dashboard signs its sign-in
// links with. Kept out of runtimes/agentwebui-lite.ts because it reads the
// database, and the runtimes stay pure for the unit tests.

import { db, teamBranding, eq, and } from "@/db"
import { BRANDING } from "@/configs/branding"
import { liteEmbedSecret } from "@/lib/runtimes/agentwebui-lite"

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

/**
 * The two sidecar env args that let the dashboard frame an agent's chat page.
 * Empty when no secret can be derived, which leaves the page at the agent's
 * own address only, rather than failing a deploy.
 */
export async function chatUiFramingArgs(instance: {
  id: string
  teamId: string | null
}): Promise<{ embedSecret?: string; frameAncestors?: string[] }> {
  try {
    return {
      embedSecret: liteEmbedSecret(instance.id),
      frameAncestors: await chatUiFrameAncestors(instance.teamId),
    }
  } catch (err) {
    console.warn(`[chat-ui] no in-dashboard chat for ${instance.id}:`, err instanceof Error ? err.message : err)
    return {}
  }
}
