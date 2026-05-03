import { reportUsage } from "./usage"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

const SOUL_MD = process.env.SOUL_MD || "You are a helpful assistant."
const MODEL = process.env.MODEL || "meta-llama/llama-3.2-3b-instruct:free"
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "google/gemini-2.0-flash-exp:free"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

async function callOpenRouter(model: string, messages: ChatMessage[]): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "http-referer": "https://sovereignml.ai",
      "x-title": "SovereignML Bot Runtime",
    },
    body: JSON.stringify({ model, messages }),
  })
}

/**
 * Generate an assistant reply. Falls back to FALLBACK_MODEL on 429/5xx.
 * Reports usage events back to the web app; reply content is returned
 * regardless of whether usage reporting succeeded.
 */
export async function generateReply(userMessage: string, history: ChatMessage[] = []): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set in the bot runtime environment.")
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SOUL_MD },
    ...history,
    { role: "user", content: userMessage },
  ]

  reportUsage("request", 1)

  let resp: Response
  let model = MODEL
  try {
    resp = await callOpenRouter(MODEL, messages)
    if (!resp.ok && (resp.status === 429 || resp.status >= 500)) {
      console.warn(`[chat] primary model ${MODEL} failed (${resp.status}); falling back to ${FALLBACK_MODEL}`)
      resp = await callOpenRouter(FALLBACK_MODEL, messages)
      model = FALLBACK_MODEL
    }
  } catch (err) {
    console.warn(`[chat] primary model ${MODEL} threw; falling back:`, err)
    resp = await callOpenRouter(FALLBACK_MODEL, messages)
    model = FALLBACK_MODEL
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 500)}`)
  }

  const data = (await resp.json()) as OpenRouterResponse
  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message}`)
  }

  const content = data.choices?.[0]?.message?.content?.trim() || ""

  const promptTokens = data.usage?.prompt_tokens ?? 0
  const completionTokens = data.usage?.completion_tokens ?? 0
  if (promptTokens > 0) reportUsage("tokens_in", promptTokens, { model })
  if (completionTokens > 0) reportUsage("tokens_out", completionTokens, { model })

  return content || "(no response)"
}
