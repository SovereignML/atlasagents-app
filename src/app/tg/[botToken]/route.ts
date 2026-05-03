import { NextRequest, NextResponse } from "next/server"
import { db, eq, instances } from "@/db"

/**
 * Centralized Telegram webhook router. Telegram POSTs updates here; we look
 * up the Instance by the path's botToken and forward the body to that bot's
 * internal `/telegram` endpoint, authenticated with X-Bot-Token.
 *
 * Telegram expects a 200 OK — if we 500, it retries. So we swallow errors
 * and just log them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ botToken: string }> }
) {
  const { botToken } = await params

  const instance = await db.query.instances.findFirst({
    where: eq(instances.botToken, botToken),
    columns: {
      id: true,
      status: true,
      ipAddress: true,
      containerPort: true,
      botToken: true,
    },
  })
  if (!instance) {
    return NextResponse.json({ ok: true, warning: "unknown botToken" })
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
