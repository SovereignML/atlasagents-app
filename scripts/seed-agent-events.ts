// Dev helper: seed synthetic AgentEvent rows for one instance so the whole
// observability pipeline (fleet dashboard, per-agent Monitoring tab, alert
// evaluation) can be exercised before any real agent emit producer exists.
//
// Writes the SAME table the ingest endpoint writes to, using the same
// instance-scoped id convention (`<instanceId>:<n>`) so re-runs are idempotent
// (onConflictDoNothing). Does NOT touch billing or call any external API.
//
// Usage:
//   npm run seed:agent-events -- <instanceId> [count]
//   npm run seed:agent-events            # picks the first non-deleted instance
//
// Then open /dashboard/monitoring and the agent's Monitoring tab.

import { db, instances, agentEvents, eq, ne } from "@/db"

const MODELS = ["anthropic/claude-haiku-4.5", "openai/gpt-4o-mini", "google/gemini-2.0-flash"]

async function main() {
  const argId = process.argv[2]
  const count = Math.max(1, Number(process.argv[3]) || 40)

  const instance = argId
    ? await db.query.instances.findFirst({
        where: eq(instances.id, argId),
        columns: { id: true, teamId: true, name: true, status: true },
      })
    : await db.query.instances.findFirst({
        where: ne(instances.status, "deleted"),
        columns: { id: true, teamId: true, name: true, status: true },
      })

  if (!instance) {
    console.error(
      argId ? `No instance ${argId}` : "No non-deleted instance found — deploy/seed one first.",
    )
    process.exit(1)
  }

  const now = Date.now()
  const rows = Array.from({ length: count }, (_, i) => {
    // Spread events across the last ~24h so windowed rollups have data.
    const occurred = new Date(now - i * Math.floor((24 * 60 * 60 * 1000) / count))
    // ~1 in 8 is an error, so error_rate alert rules can trip.
    const isError = i % 8 === 3
    const model = MODELS[i % MODELS.length]
    return {
      id: `${instance.id}:seed-${i}`,
      instanceId: instance.id,
      teamId: instance.teamId,
      type: isError ? "error" : "run.finished",
      occurredAt: occurred,
      runId: `seed-run-${i}`,
      sessionId: `seed-sess-${Math.floor(i / 4)}`,
      model,
      tokensIn: 200 + ((i * 37) % 1800),
      tokensOut: 120 + ((i * 53) % 900),
      costUsd: Math.round((0.001 + ((i * 7) % 50) / 1000) * 10000) / 10000,
      latencyMs: 300 + ((i * 91) % 4000),
      status: isError ? "error" : "ok",
      detail: { seeded: true },
    }
  })

  const inserted = await db.insert(agentEvents).values(rows).onConflictDoNothing().returning({
    id: agentEvents.id,
  })
  await db
    .update(instances)
    .set({ lastEventAt: new Date(), lastActiveAt: new Date() })
    .where(eq(instances.id, instance.id))

  console.log(
    `Seeded ${inserted.length}/${rows.length} events (rest already present) for "${instance.name}" (${instance.id}).`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
