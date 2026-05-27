// Slack channel: POST to a user-provided incoming webhook URL.
export async function deliverSlack(params: {
  webhookUrl: string
  title: string
  message: string
  url?: string
}) {
  const text = `*${params.title}*\n${params.message}${params.url ? `\n<${params.url}>` : ""}`

  const res = await fetch(params.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    console.warn(`[notify] slack webhook failed: ${res.status}`)
  }
}
