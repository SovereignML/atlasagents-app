import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceKnowledge, instanceLogs, eq, and, desc } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { syncKnowledgeBase } from "@/lib/provisioner"
import { logAuditEvent } from "@/lib/audit"

/** Max stored text per source — sources are small references, not corpora. */
const MAX_TEXT_BYTES = 200_000

/** Strip HTML to rough plain text for a fetched URL. Best-effort, not a parser. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
}

async function loadInstance(instanceId: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" as const, status: 401 }
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance || instance.status === "deleted") {
    return { error: "Instance not found" as const, status: 404 }
  }
  return { session, isAdmin, effectiveUserId, instance }
}

/** GET — list this agent's knowledge sources (metadata only, not the full text). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadInstance(instanceId)
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }

  const rows = await db
    .select({
      id: instanceKnowledge.id,
      type: instanceKnowledge.type,
      name: instanceKnowledge.name,
      sourceUrl: instanceKnowledge.sourceUrl,
      sizeBytes: instanceKnowledge.sizeBytes,
      createdAt: instanceKnowledge.createdAt,
    })
    .from(instanceKnowledge)
    .where(eq(instanceKnowledge.instanceId, instanceId))
    .orderBy(desc(instanceKnowledge.createdAt))

  return NextResponse.json({ items: rows })
}

/** POST — add a knowledge source (uploaded text or a URL we fetch+extract). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadInstance(instanceId)
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  const { session, isAdmin, effectiveUserId, instance } = ctx
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { type, name, sourceUrl, textContent } = body as {
    type?: unknown
    name?: unknown
    sourceUrl?: unknown
    textContent?: unknown
  }

  if (type !== "url" && type !== "file") {
    return NextResponse.json({ error: 'type must be "url" or "file"' }, { status: 400 })
  }

  let resolvedName = typeof name === "string" ? name.trim() : ""
  let text = typeof textContent === "string" ? textContent : ""
  let url: string | null = null

  if (type === "url") {
    if (typeof sourceUrl !== "string" || !/^https?:\/\//i.test(sourceUrl.trim())) {
      return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 })
    }
    url = sourceUrl.trim()
    if (!resolvedName) resolvedName = url
    // Fetch + extract if the client didn't supply text.
    if (!text) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15_000)
        const res = await fetch(url, { signal: controller.signal, redirect: "follow" })
        clearTimeout(timer)
        if (res.ok) text = htmlToText(await res.text())
      } catch {
        // Leave text empty — the source is still saved (name + URL header).
      }
    }
  } else {
    if (!resolvedName) {
      return NextResponse.json({ error: "A name is required for file sources" }, { status: 400 })
    }
    if (!text.trim()) {
      return NextResponse.json({ error: "File text content is required" }, { status: 400 })
    }
  }

  // Cap stored text (byte-safe truncation).
  const buf = Buffer.from(text, "utf8")
  if (buf.byteLength > MAX_TEXT_BYTES) {
    text = buf.subarray(0, MAX_TEXT_BYTES).toString("utf8")
  }
  const sizeBytes = Buffer.byteLength(text, "utf8")

  const [row] = await db
    .insert(instanceKnowledge)
    .values({
      instanceId,
      type,
      name: resolvedName.slice(0, 200),
      textContent: text,
      sourceUrl: url,
      sizeBytes,
      createdBy: session.user.id,
    })
    .returning({ id: instanceKnowledge.id })

  // Push the corpus to the live agent (no restart needed for content changes).
  if (instance.status === "running") {
    try {
      const fresh = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) })
      if (fresh) await syncKnowledgeBase(fresh)
    } catch (err) {
      console.error(`[knowledge] sync failed for ${instanceId}:`, err)
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Knowledge source added: "${resolvedName.slice(0, 80)}" (${type}).`,
  })
  await logAuditEvent({
    userId: session.user.id,
    action: "instance.knowledge_add",
    targetType: "instance",
    targetId: instanceId,
    targetLabel: instance.name,
    meta: { type, name: resolvedName.slice(0, 200) },
  })

  return NextResponse.json({ success: true, id: row?.id })
}

/** DELETE — remove a knowledge source by id (?id=...). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadInstance(instanceId)
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  const { isAdmin, effectiveUserId, instance } = ctx
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 })
  }

  await db
    .delete(instanceKnowledge)
    .where(and(eq(instanceKnowledge.id, id), eq(instanceKnowledge.instanceId, instanceId)))

  if (instance.status === "running") {
    try {
      const fresh = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) })
      if (fresh) await syncKnowledgeBase(fresh)
    } catch (err) {
      console.error(`[knowledge] sync failed for ${instanceId}:`, err)
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: "Knowledge source removed.",
  })

  return NextResponse.json({ success: true })
}
