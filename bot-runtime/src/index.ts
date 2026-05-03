import express, { NextFunction, Request, Response } from "express"
import { generateReply, ChatMessage } from "./chat"
import { handleTelegramUpdate } from "./telegram"

const PORT = Number(process.env.PORT || 3000)
const BOT_TOKEN = process.env.BOT_TOKEN || ""
const INSTANCE_ID = process.env.INSTANCE_ID || "unknown"

const app = express()
app.use(express.json({ limit: "1mb" }))

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, instanceId: INSTANCE_ID, uptime: process.uptime() })
})

function requireBotToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("x-bot-token") || req.header("authorization")?.replace(/^Bearer\s+/i, "") || ""
  if (!BOT_TOKEN || auth !== BOT_TOKEN) {
    res.status(401).json({ error: "invalid bot token" })
    return
  }
  next()
}

app.post("/chat", requireBotToken, async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body as { message?: string; history?: ChatMessage[] }
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" })
      return
    }
    const reply = await generateReply(message, Array.isArray(history) ? history : [])
    res.json({ reply })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[chat] error:", msg)
    res.status(500).json({ error: msg })
  }
})

// Telegram endpoint — forwarded by the web app's /tg/<botToken> route.
// We still require the X-Bot-Token header so the tunnel can't be abused.
app.post("/telegram", requireBotToken, async (req: Request, res: Response) => {
  try {
    await handleTelegramUpdate(req.body)
    res.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[telegram] error:", msg)
    // Always 200 so Telegram doesn't retry on internal failures.
    res.json({ ok: true, warning: msg })
  }
})

app.listen(PORT, () => {
  console.log(`[bot-runtime] listening on :${PORT} for instance ${INSTANCE_ID}`)
})
