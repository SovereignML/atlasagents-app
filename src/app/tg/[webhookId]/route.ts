import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { db, eq, instances } from "@/db"
import { decryptSecret } from "@/lib/crypto-secret"

/**
 * Centralized Telegram webhook router.
 *
 * Telegram POSTs updates to /tg/<telegramWebhookId>. We look up the instance by
 * that non-secret id, verify the X-Telegram-Bot-Api-Secret-Token header against
 * the per-instance secret we set on setWebhook (so a third party who learns the
 * URL can't spoof updates), then forward the body to the bot's internal
 * `/telegram` endpoint authenticated with X-Bot-Token.
 *
 * Legacy bots connected before the secret existed used /tg/<botToken>; we keep
 * resolving those by botToken (no secret to check) so they keep working until
 * the owner reconnects and migrates to the secure URL.
 *
 * Telegram expects a 200 OK — a non-200 makes it retry — so we always return
 * 200 and just decline to forward anything we can't authenticate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> }
) {
  const { webhookId } = await params

  // Primary path: resolve by the non-secret webhook id.
  let instance = await db.query.instances.findFirst({
    where: eq(instances.telegramWebhookId, webhookId),
    columns: {
      id: true,
      status: true,
      ipAddress: true,
      containerPort: true,
      botToken: true,
      telegramWebhookSecretEnc: true,
    },
  })
  let legacy = false

  // Legacy fallback: the path was the bot token itself (pre-secret webhooks).
  if (!instance) {
    instance = await db.query.instances.findFirst({
      where: eq(instances.botToken, webhookId),
      columns: {
        id: true,
        status: true,
        ipAddress: true,
        containerPort: true,
        botToken: true,
        telegramWebhookSecretEnc: true,
      },
    })
    legacy = true
  }

  if (!instance) {
    return NextResponse.json({ ok: true, warning: "unknown webhook" })
  }

  // Verify the secret_token header for the secure path. Decline (but 200)
  // anything that doesn't match so Telegram won't retry spoofed updates.
  if (!legacy && instance.telegramWebhookSecretEnc) {
    const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? ""
    let expected = ""
    try {
      expected = decryptSecret(instance.telegramWebhookSecretEnc)
    } catch {
      console.warn(`[tg] secret decrypt failed for instance ${instance.id}`)
      return NextResponse.json({ ok: true, warning: "secret unavailable" })
    }
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b)
    if (!valid) {
      console.warn(`[tg] rejected update with bad secret for instance ${instance.id}`)
      return NextResponse.json({ ok: true, warning: "bad secret" })
    }
  }

  if (instance.status !== "running") {
    return NextResponse.json({ ok: true, warning: `instance status ${instance.status}` })
  }
  if (!instance.ipAddress || !instance.containerPort) {
    return NextResponse.json({ ok: true, warning: "instance has no ipAddress/containerPort" })
  }

  const upstream = `http://${instance.ipAddress}:${instance.containerPort}/telegram`

  let bodyText = ""
  try {
    bodyText = await req.text()
  } catch {
    // Ignore — empty body is fine.
  }

  try {
    await fetch(upstream, {
      method: "POST",
      headers: {
        "content-type": req.headers.get("content-type") ?? "application/json",
        "x-bot-token": instance.botToken ?? "",
      },
      body: bodyText,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.warn(`[tg] forward to ${upstream} failed:`, err)
  }

  return NextResponse.json({ ok: true })
}
