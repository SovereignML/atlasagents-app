import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { auth } from "@/auth"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { encryptSecret } from "@/lib/crypto-secret"
import { reprovisionBotEnv } from "@/lib/provisioner"

type ConnectBody = {
  kind: "telegram"
  token: string
}

type TelegramGetMe = {
  ok: boolean
  result?: { id: number; username?: string; first_name?: string }
  description?: string
}

const GATEWAY_BASE = () =>
  process.env.NEXT_PUBLIC_GATEWAY_BASE_URL || "http://localhost:3000"

async function telegramApi<T>(token: string, method: string, body?: object): Promise<T> {
  const url = `https://api.telegram.org/bot${token}/${method}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return (await res.json()) as T
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(session.user.id, instanceId),
  })
  if (!instance) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Connecting an interface is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(session.user.id, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!instance.botToken) {
    return NextResponse.json(
      { error: "Instance is missing a botToken — re-deploy this instance first." },
      { status: 400 }
    )
  }

  const body = (await req.json()) as ConnectBody
  if (body.kind !== "telegram" || !body.token || typeof body.token !== "string") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Validate token via getMe.
  const me = await telegramApi<TelegramGetMe>(body.token, "getMe")
  if (!me.ok || !me.result) {
    return NextResponse.json(
      { error: `Telegram rejected the token: ${me.description ?? "getMe failed"}` },
      { status: 400 }
    )
  }

  // Set webhook to our centralized router. The URL carries a non-secret random
  // id (never the bot token — that leaks into proxy/CDN logs), and Telegram
  // echoes our secret_token back in the X-Telegram-Bot-Api-Secret-Token header
  // so the receiver can reject spoofed updates.
  const webhookId = crypto.randomBytes(16).toString("hex")
  const webhookSecret = crypto.randomBytes(24).toString("hex")
  const webhookUrl = `${GATEWAY_BASE()}/tg/${webhookId}`
  const setHook = await telegramApi<{ ok: boolean; description?: string }>(
    body.token,
    "setWebhook",
    { url: webhookUrl, allowed_updates: ["message"], secret_token: webhookSecret }
  )
  if (!setHook.ok) {
    return NextResponse.json(
      { error: `Telegram setWebhook failed: ${setHook.description ?? "unknown"}` },
      { status: 502 }
    )
  }

  // Persist (encrypted) and push fresh env to the container.
  const [updated] = await db
    .update(instances)
    .set({
      telegramBotTokenEnc: encryptSecret(body.token),
      telegramUsername: me.result.username ?? null,
      telegramWebhookId: webhookId,
      telegramWebhookSecretEnc: encryptSecret(webhookSecret),
      interfaceKind: "telegram",
    })
    .where(eq(instances.id, instanceId))
    .returning()
  try {
    await reprovisionBotEnv(updated)
  } catch (err) {
    console.warn(`[interfaces/connect] reprovision failed:`, err)
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Telegram connected as @${me.result.username ?? "(no username)"}.`,
  })

  return NextResponse.json({
    ok: true,
    username: me.result.username,
  })
}
