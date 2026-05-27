import { NextRequest, NextResponse } from "next/server"
import { db, notificationPreferences, eq } from "@/db"
import { sendTelegramRaw } from "@/lib/notifications/channels/telegram"

/**
 * POST /api/notifications/telegram/webhook
 *
 * Receives updates from the dedicated SovereignML notifications bot (distinct
 * from users' deployed bots at /tg/[botToken]). Handles the `/start <token>`
 * connect handshake: matches the link token minted by ../link, stores the
 * sender's chat id, and confirms back. Always returns 200 so Telegram doesn't
 * retry.
 *
 * Register once:
 *   curl "https://api.telegram.org/bot<token>/setWebhook" \
 *     -d url=<APP_URL>/api/notifications/telegram/webhook \
 *     -d secret_token=<NOTIFY_TELEGRAM_WEBHOOK_SECRET>
 */
export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_TELEGRAM_WEBHOOK_SECRET
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true }) // ignore unauthenticated calls quietly
  }

  let update: {
    message?: { text?: string; chat?: { id?: number | string } }
  }
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const text = update.message?.text?.trim() ?? ""
  const chatId = update.message?.chat?.id

  if (chatId != null && text.startsWith("/start")) {
    const token = text.split(/\s+/)[1]
    if (token) {
      const prefs = await db.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.telegramLinkToken, token),
      })
      if (prefs) {
        await db
          .update(notificationPreferences)
          .set({ telegramChatId: String(chatId), telegramLinkToken: null })
          .where(eq(notificationPreferences.id, prefs.id))
        await sendTelegramRaw(
          chatId,
          "✅ Connected! You'll now receive SovereignML notifications here. Manage channels in your account settings.",
        )
      } else {
        await sendTelegramRaw(
          chatId,
          "This connect link is invalid or has already been used. Generate a new one from your SovereignML account settings.",
        )
      }
    }
  }

  return NextResponse.json({ ok: true })
}
