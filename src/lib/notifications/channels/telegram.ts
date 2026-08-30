// Telegram channel: send via the dedicated Atlas Agents notifications bot.
// This bot is distinct from users' own deployed bots (routed at /tg/[botToken]).

const API_BASE = "https://api.telegram.org"

export async function deliverTelegram(params: {
  chatId: string
  title: string
  message: string
  url?: string
}) {
  const token = process.env.NOTIFY_TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn("[notify] NOTIFY_TELEGRAM_BOT_TOKEN not set — Telegram delivery skipped")
    return
  }

  // Plain text (no parse_mode) avoids Markdown-escaping pitfalls.
  const text = `${params.title}\n${params.message}${params.url ? `\n\n${params.url}` : ""}`

  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: params.chatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    console.warn(
      `[notify] telegram sendMessage failed: ${res.status} ${await res.text().catch(() => "")}`,
    )
  }
}

// Used by the connect-flow webhook to confirm a successful link back to the user.
export async function sendTelegramRaw(chatId: string | number, text: string) {
  const token = process.env.NOTIFY_TELEGRAM_BOT_TOKEN
  if (!token) return
  try {
    await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.warn("[notify] telegram confirmation send failed:", err)
  }
}
