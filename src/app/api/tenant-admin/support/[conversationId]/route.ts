import { NextResponse } from "next/server"
import { z } from "zod"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import {
  resolveChatwootForTeam,
  getConversationMessages,
  getConversation,
  postAgentReply,
  setConversationStatus,
} from "@/lib/chatwoot"
import { logAuditEvent } from "@/lib/audit"

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// GET — messages + state for one conversation in the tenant inbox.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const { conversationId } = await params
  const id = parseId(conversationId)
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const cfg = await resolveChatwootForTeam(admin.tenantTeamId)
  if (!cfg) return NextResponse.json({ error: "Chatwoot not configured" }, { status: 409 })

  const [messages, state] = await Promise.all([
    getConversationMessages(cfg, id),
    getConversation(cfg, id),
  ])
  return NextResponse.json({ messages, state })
}

const replySchema = z.object({ content: z.string().min(1).max(10_000) })

// POST — agent reply (outgoing) into the conversation.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const { conversationId } = await params
  const id = parseId(conversationId)
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = replySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const cfg = await resolveChatwootForTeam(admin.tenantTeamId)
  if (!cfg) return NextResponse.json({ error: "Chatwoot not configured" }, { status: 409 })

  const ok = await postAgentReply(cfg, id, parsed.data.content)
  if (!ok) return NextResponse.json({ error: "Failed to send reply" }, { status: 502 })

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.support.reply",
    teamId: admin.tenantTeamId,
    targetType: "conversation",
    targetId: String(id),
  })
  return NextResponse.json({ ok: true })
}

const statusSchema = z.object({ status: z.enum(["resolved", "open"]) })

// PATCH — resolve/reopen the conversation.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const { conversationId } = await params
  const id = parseId(conversationId)
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = statusSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const cfg = await resolveChatwootForTeam(admin.tenantTeamId)
  if (!cfg) return NextResponse.json({ error: "Chatwoot not configured" }, { status: 409 })

  const ok = await setConversationStatus(cfg, id, parsed.data.status)
  if (!ok) return NextResponse.json({ error: "Failed to update status" }, { status: 502 })

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.support.status",
    teamId: admin.tenantTeamId,
    targetType: "conversation",
    targetId: String(id),
    meta: { status: parsed.data.status },
  })
  return NextResponse.json({ ok: true })
}
