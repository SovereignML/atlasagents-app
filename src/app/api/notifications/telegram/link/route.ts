import { NextResponse } from "next/server"
import { createId } from "@paralleldrive/cuid2"
import { auth } from "@/auth"
import { db, notificationPreferences, eq } from "@/db"

/**
 * POST /api/notifications/telegram/link
 *
 * Starts the Telegram connect flow: mints a one-time link token, stores it on
 * the user's preferences row, and returns a t.me deep link. When the user taps
 * Start in Telegram, the webhook (../webhook) captures their chat id.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const username = process.env.NOTIFY_TELEGRAM_BOT_USERNAME
  if (!process.env.NOTIFY_TELEGRAM_BOT_TOKEN || !username) {
    return NextResponse.json(
      { error: "Telegram notifications are not configured on this server." },
      { status: 503 },
    )
  }

  const token = createId()
  await db
    .insert(notificationPreferences)
    .values({ userId: session.user.id, telegramLinkToken: token })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { telegramLinkToken: token },
    })

  return NextResponse.json({
    url: `https://t.me/${username}?start=${token}`,
  })
}

/**
 * DELETE /api/notifications/telegram/link — disconnect Telegram.
 */
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await db
    .update(notificationPreferences)
    .set({ telegramChatId: null, telegramLinkToken: null })
    .where(eq(notificationPreferences.userId, session.user.id))

  return NextResponse.json({ ok: true })
}
