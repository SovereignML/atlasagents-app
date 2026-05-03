import { generateReply } from "./chat"

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""

type TelegramUpdate = {
  message?: {
    chat?: { id: number }
    text?: string
  }
}

async function sendMessage(chatId: number, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch((err) => {
    console.error("[telegram] sendMessage failed:", err?.message || err)
  })
}

/**
 * Handle a Telegram update forwarded by the web app at /tg/<botToken>.
 * Never rejects — always returns { ok: true } so Telegram doesn't retry
 * on transient failures; errors are logged and surfaced as a user-facing
 * error message in the chat.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat?.id
  const text = update.message?.text?.trim()
  if (!chatId || !text) return
  try {
    const reply = await generateReply(text)
    await sendMessage(chatId, reply)
  } catch (err) {
    console.error("[telegram] handler error:", err)
    await sendMessage(chatId, "Sorry — I hit an error generating a reply. Please try again in a moment.")
  }
}
