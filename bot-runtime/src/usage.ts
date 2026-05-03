/**
 * Fire-and-forget usage reporter. The web app's /api/usage/ingest route
 * decrements credits and inserts a UsageEvent row. We authenticate with the
 * bot's BOT_TOKEN via an X-Bot-Token header.
 */

type UsageKind = "request" | "tokens_in" | "tokens_out"

const USAGE_INGEST_URL = process.env.USAGE_INGEST_URL || ""
const BOT_TOKEN = process.env.BOT_TOKEN || ""
const INSTANCE_ID = process.env.INSTANCE_ID || ""

export function reportUsage(kind: UsageKind, amount: number, meta?: Record<string, unknown>) {
  if (!USAGE_INGEST_URL || !BOT_TOKEN) return
  const body = JSON.stringify({ kind, amount, meta, instanceId: INSTANCE_ID })
  // Intentionally not awaited. Errors are logged but never thrown.
  fetch(USAGE_INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-token": BOT_TOKEN,
    },
    body,
  }).catch((err) => {
    console.error("[usage] ingest failed:", err?.message || err)
  })
}
