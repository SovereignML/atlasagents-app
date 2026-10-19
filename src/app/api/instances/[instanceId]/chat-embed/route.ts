import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { apiError } from "@/lib/api-error"
import {
  CHAT_UI_LITE,
  buildLiteEmbedUrl,
  chatUiOf,
  liteEmbedSecret,
} from "@/lib/runtimes/agentwebui-lite"

/**
 * POST — a one-time link that signs this browser in to the agent's chat page
 * (AgentWebUI Lite) and opens it. The dashboard puts it in an iframe, or opens
 * it in a new tab. Each link works once, for one minute, so the dashboard asks
 * for a fresh one every time it opens the chat.
 *
 * Chatting runs the agent (tools, files, the customer's credits), so it needs
 * Operator or above on the agent, like the admin login does.
 */
export async function POST(
  _req: NextRequest,
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!instance.webuiEnabled || chatUiOf(instance) !== CHAT_UI_LITE) {
      return NextResponse.json(
        { error: "This agent's chat page can't be embedded.", code: "NOT_EMBEDDABLE" },
        { status: 409 },
      )
    }
    if (instance.status !== "running") {
      return NextResponse.json(
        { error: "The agent isn't running, so its chat page is offline." },
        { status: 409 },
      )
    }

    const access = buildPublicGatewayUrl({
      domain: instance.domain,
      managedSubdomain: instance.managedSubdomain,
      tlsStatus: instance.tlsStatus,
      ipAddress: instance.ipAddress,
    })
    // The sign-in cookie a framed page needs is SameSite=None, which browsers
    // only accept over HTTPS.
    if (!access?.url.startsWith("https://")) {
      return NextResponse.json(
        {
          error: "The chat page needs HTTPS, and this agent's certificate isn't ready yet. Try again in a few minutes.",
          code: "NO_HTTPS",
        },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { url: buildLiteEmbedUrl(access.url, liteEmbedSecret(instance.id)) },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    return apiError("instances/chat-embed", err)
  }
}
