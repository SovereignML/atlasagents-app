// Discord channel: POST to a user-provided incoming webhook URL. No bot,
// no OAuth — the user pastes a webhook from their server's channel settings.
export async function deliverDiscord(params: {
  webhookUrl: string
  title: string
  message: string
  url?: string
}) {
  const content = `**${params.title}**\n${params.message}${params.url ? `\n${params.url}` : ""}`

  const res = await fetch(params.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 1900) }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    console.warn(`[notify] discord webhook failed: ${res.status}`)
  }
}
