import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { apiError } from "@/lib/api-error"
import { chatUiFrameAncestors } from "@/lib/chat-ui-origins"
import { ensureChatEmbeddable } from "@/lib/chat-embed"
import { buildLiteEmbedUrl, liteEmbedSecret, runsLite } from "@/lib/runtimes/agentwebui-lite"

/**
 * POST — a one-time link that signs this browser in to the agent's chat page
 * (AgentWebUI Lite) and opens it. The dashboard puts it in its chat window, or
 * opens it in a new tab. Each link works once, for one minute, so the
 * dashboard asks for a fresh one every time it opens the chat.
 *
 * The first open of an agent set up before in-dashboard chat rewrites its
 * chat page's settings and restarts it (a few seconds), or upgrades a box on
 * an older Lite release (about a minute).
 *
 * Chatting runs the agent (tools, files, the customer's credits), so it needs
 * Operator or above on the agent, like the admin login does.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { instanceId } = await params
    const isAdmin = (session.user as { role?: string }).role === "admin"
    const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
    const instance = await db.query.instances.findFirst({
      where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
    })
    if (!instance || instance.status === "deleted") {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 })
    }
    if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
      return NextResponse.json({ error: "You need Operator access to chat with this agent." }, { status: 403 })
    }
    if (!instance.webuiEnabled) {
      return NextResponse.json(
        { error: "This agent has no chat page.", code: "NOT_EMBEDDABLE" },
        { status: 409 },
      )
    }
    // Made before AgentWebUI Lite and not moved yet. Moving deletes its Open
    // WebUI chat history, so it happens on the agent's next update (or
    // `chat-ui:migrate`), never as a side effect of opening the chat.
    if (!runsLite(instance)) {
      return NextResponse.json(
        {
          error: "This agent still has the old chat page. Open it in a new tab; it switches to the new one on its next update.",
          code: "NOT_MIGRATED",
        },
        { status: 409 },
      )
    }
    if (instance.status !== "running") {
      return NextResponse.json(
        { error: "The agent isn't running, so its chat is offline.", code: "NOT_RUNNING" },
        { status: 409 },
      )
    }

    const access = buildPublicGatewayUrl({
      domain: instance.domain,
      managedSubdomain: instance.managedSubdomain,
      tlsStatus: instance.tlsStatus,
      ipAddress: instance.ipAddress,
    })
    // The framed sign-in cookie is SameSite=None, which browsers only accept
    // over HTTPS.
    if (!access?.url.startsWith("https://")) {
      return NextResponse.json(
        {
          error: "The chat needs HTTPS, and this agent's certificate isn't ready yet. Try again in a few minutes.",
          code: "NO_HTTPS",
        },
        { status: 409 },
      )
    }

    // The page lets only the dashboard's own origins frame it. The browser
    // names the one this request came from.
    const origin = req.headers.get("origin")?.replace(/\/+$/, "") ?? ""
    const allowed = await chatUiFrameAncestors(instance.teamId)
    if (!allowed.includes(origin)) {
      return NextResponse.json(
        {
          error: "The chat can't be shown inside the dashboard at this address. Open it in a new tab.",
          code: "ORIGIN_NOT_ALLOWED",
        },
        { status: 409 },
      )
    }

    // Older agents: set up the chat page for the dashboard on first open (an
    // agent still on Open WebUI is moved to Lite here, too).
    const readiness = await ensureChatEmbeddable(instance, access.url, origin)
    if (!readiness.ok) {
      return NextResponse.json({ error: readiness.error, code: readiness.code }, { status: 503 })
    }
    return NextResponse.json(
      {
        url: buildLiteEmbedUrl(access.url, liteEmbedSecret(instance.id)),
        origin: new URL(access.url).origin,
        updated: readiness.updated,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    return apiError("instances/chat-embed", err)
  }
}
