import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { encryptSecret } from "@/lib/crypto-secret"
import { reprovisionBotEnv } from "@/lib/provisioner"
import { registerTelegramWebhook, telegramApi } from "@/lib/telegram-webhook"

type ConnectBody = {
  kind: "telegram"
  token: string
}

type TelegramUser = { id: number; username?: string; first_name?: string }

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
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Connecting an interface is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!instance.botToken) {
    return NextResponse.json(
      { error: "Instance is missing a botToken. Re-deploy this instance first." },
      { status: 400 }
    )
  }

  const body = (await req.json()) as ConnectBody
  if (body.kind !== "telegram" || !body.token || typeof body.token !== "string") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Validate token via getMe.
  const me = await telegramApi<TelegramUser>(body.token, "getMe")
  if (!me.ok || !me.result) {
    return NextResponse.json(
      { error: `Telegram rejected the token: ${me.description ?? "getMe failed"}` },
      { status: 400 }
    )
  }

  // Point the bot at our router on the secure, token-free path.
  const hook = await registerTelegramWebhook(body.token)
  if (!hook.ok) {
    return NextResponse.json(
      { error: `Telegram setWebhook failed: ${hook.error}` },
      { status: 502 }
    )
  }
  const { webhookId, webhookSecret } = hook

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
