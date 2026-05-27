import { NextRequest, NextResponse } from "next/server"
import { db, eq, instances, usageEvents } from "@/db"
import { rateLimit } from "@/lib/rate-limit"

/**
 * Bot runtimes POST usage events here. This endpoint is ANALYTICS-ONLY: it
 * records the event and bumps `lastActiveAt`. It does NOT charge the wallet.
 *
 * Wallet billing is now driven by REAL OpenRouter spend, polled per-key by the
 * usage-sync job (src/lib/openrouter-usage.ts) and marked up by the margin.
 * The per-key OpenRouter cap (= funded credits × margin) is the hard cost
 * ceiling. The synthetic per-request/token rates that used to live here
 * (USAGE_COST_PER_* env vars) are DEPRECATED and no longer read.
 *
 * Auth: X-Bot-Token header must match Instance.botToken. This is a shared
 * secret baked into the container's env at provision time.
 */

type IngestBody = {
  kind: "request" | "tokens_in" | "tokens_out"
  amount: number
  meta?: Record<string, unknown>
  instanceId?: string
}

// Per-kind upper bounds. Kept as a sanity guard so a leaked bot token can't
// flood the usageEvents table with absurd amounts.
const MAX_AMOUNTS: Record<IngestBody["kind"], number> = {
  request: 1,
  tokens_in: 200_000,
  tokens_out: 200_000,
}

export async function POST(req: NextRequest) {
  const botToken = req.headers.get("x-bot-token")
  if (!botToken) {
    return NextResponse.json({ error: "missing x-bot-token" }, { status: 401 })
  }

  const instance = await db.query.instances.findFirst({
    where: eq(instances.botToken, botToken),
  })
  if (!instance) {
    return NextResponse.json({ error: "invalid bot token" }, { status: 401 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "invalid bot token" }, { status: 401 })
  }

  // Cap per-token request rate. 600/min ≈ 10/s — orders of magnitude above any
  // legitimate bot's usage cadence, but prevents a leaked token from being
  // replayed in a tight loop to drain the wallet via wave-of-small-events.
  if (!(await rateLimit(`usage:${instance.id}`, 600, 60_000))) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 })
  }

  let body: IngestBody
  try {
    body = (await req.json()) as IngestBody
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  if (!body.kind || typeof body.amount !== "number") {
    return NextResponse.json({ error: "kind and amount are required" }, { status: 400 })
  }
  if (!Number.isFinite(body.amount) || body.amount < 0) {
    return NextResponse.json({ error: "amount must be a non-negative finite number" }, { status: 400 })
  }
  const maxForKind = MAX_AMOUNTS[body.kind]
  if (maxForKind === undefined) {
    return NextResponse.json({ error: `unknown kind: ${body.kind}` }, { status: 400 })
  }
  if (body.amount > maxForKind) {
    return NextResponse.json(
      { error: `amount ${body.amount} exceeds max ${maxForKind} for kind ${body.kind}` },
      { status: 400 },
    )
  }

  await db.insert(usageEvents).values({
    instanceId: instance.id,
    userId: instance.userId,
    kind: body.kind,
    amount: Math.round(body.amount),
    meta: body.meta ?? null,
  })

  if (body.kind === "request") {
    await db
      .update(instances)
      .set({ lastActiveAt: new Date() })
      .where(eq(instances.id, instance.id))
  }

  // Analytics-only — billing is reconciled from real OpenRouter spend by the
  // usage-sync job, not from these synthetic event counts.
  return NextResponse.json({ ok: true })
}
