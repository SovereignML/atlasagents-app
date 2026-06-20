// Agent → platform observability ingest. The agent (or its forwarder/poller)
// POSTs batches of runtime events here; we authenticate with the per-instance
// ingest token (NOT a user session, NOT the gateway token), validate, and
// bulk-insert into AgentEvent.
//
// Auth: Authorization: Bearer <PLATFORM_EVENT_INGEST_TOKEN>, compared
// constant-time against the instance's decrypted eventIngestTokenEnc. A leaked
// token can only write events for ONE instance.
//
// Dedup: each event's stable client id becomes part of the AgentEvent primary
// key (`<instanceId>:<event.id>`), so a retried batch is absorbed by
// onConflictDoNothing. Dedup state therefore lives in (and is pruned with) the
// high-volume events table itself — we deliberately do NOT use the low-volume
// processedEvents/claimEvent dedup store here.

import { NextRequest, NextResponse } from "next/server"
import { db, instances, agentEvents, and, eq, desc, lt } from "@/db"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { timingSafeBearerEquals } from "@/lib/cron-auth"
import { decryptSecret } from "@/lib/crypto-secret"
import { agentEventsBatchSchema } from "@/lib/validations"
import { whereUserInstanceVisible } from "@/lib/instance-queries"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

// GET — list recent agent events for the dashboard's per-agent monitoring tab.
// Session-authed + visibility-scoped (any role that can view the instance);
// cursor-paginated, mirroring the instance logs route.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const { instanceId } = await params

  const visible = await db.query.instances.findFirst({
    where: whereUserInstanceVisible(effectiveUserId, instanceId),
    columns: { id: true },
  })
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const url = new URL(req.url)
  const cursor = url.searchParams.get("cursor")
  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  const conditions = [eq(agentEvents.instanceId, instanceId)]
  if (cursor) conditions.push(lt(agentEvents.id, cursor))

  const events = await db.query.agentEvents.findMany({
    where: and(...conditions),
    orderBy: desc(agentEvents.createdAt),
    limit: limit + 1,
  })

  const hasMore = events.length > limit
  const page = hasMore ? events.slice(0, limit) : events
  return NextResponse.json({
    events: page.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      model: e.model,
      tokensIn: e.tokensIn,
      tokensOut: e.tokensOut,
      costUsd: e.costUsd,
      latencyMs: e.latencyMs,
      runId: e.runId,
      occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params

  const instance = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    columns: { id: true, teamId: true, status: true, eventIngestTokenEnc: true },
  })

  // Opaque 401 whether the instance is missing, soft-deleted, or token-less —
  // never reveal which instance ids exist to an unauthenticated caller.
  if (!instance || instance.status === "deleted" || !instance.eventIngestTokenEnc) {
    return unauthorized()
  }

  let expected: string
  try {
    expected = decryptSecret(instance.eventIngestTokenEnc)
  } catch {
    return unauthorized()
  }
  if (!timingSafeBearerEquals(req, expected)) {
    return unauthorized()
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = agentEventsBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const rows = parsed.data.events.map((e) => {
    const occurred = e.occurredAt ? new Date(e.occurredAt) : null
    return {
      // Stable, instance-scoped PK so retries dedupe on insert.
      id: `${instanceId}:${e.id}`,
      instanceId,
      teamId: instance.teamId,
      type: e.type,
      occurredAt: occurred && !Number.isNaN(occurred.getTime()) ? occurred : null,
      runId: e.runId ?? null,
      sessionId: e.sessionId ?? null,
      model: e.model ?? null,
      tokensIn: e.tokensIn ?? null,
      tokensOut: e.tokensOut ?? null,
      costUsd: e.costUsd ?? null,
      latencyMs: e.latencyMs ?? null,
      status: e.status ?? null,
      detail: (e.detail ?? null) as never,
    }
  })

  const inserted = await db
    .insert(agentEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: agentEvents.id })

  // Bump liveness markers. lastEventAt tracks the event pipeline; lastActiveAt
  // is the broad "agent did something" signal used elsewhere in the dashboard.
  const seenAt = new Date()
  await db
    .update(instances)
    .set({ lastEventAt: seenAt, lastActiveAt: seenAt })
    .where(eq(instances.id, instanceId))

  return NextResponse.json(
    { accepted: rows.length, inserted: inserted.length },
    { status: 202 },
  )
}
