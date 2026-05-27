import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { db, notificationPreferences, eq } from "@/db"
import { CATEGORIES, CHANNELS, resolveMatrix } from "@/lib/notifications/types"

const bodySchema = z.object({
  matrix: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  discordWebhookUrl: z.string().trim().max(500).optional().nullable(),
  slackWebhookUrl: z.string().trim().max(500).optional().nullable(),
})

// Normalize an https webhook URL: "" → null (clear); reject non-https.
function cleanWebhook(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined // not being updated
  const v = (value ?? "").trim()
  if (!v) return null
  if (!/^https:\/\//i.test(v)) throw new Error("Webhook URL must start with https://")
  return v
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const prefs = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, session.user.id),
  })

  return NextResponse.json({
    matrix: resolveMatrix(prefs?.matrix),
    telegramLinked: !!prefs?.telegramChatId,
    telegramAvailable: !!process.env.NOTIFY_TELEGRAM_BOT_TOKEN,
    discordWebhookUrl: prefs?.discordWebhookUrl ?? "",
    slackWebhookUrl: prefs?.slackWebhookUrl ?? "",
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await req.json())
  } catch (err) {
    const msg = err instanceof z.ZodError ? "Invalid request body" : "Invalid JSON"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // Only persist known category/channel keys as booleans.
  const set: {
    matrix?: Record<string, Record<string, boolean>>
    discordWebhookUrl?: string | null
    slackWebhookUrl?: string | null
  } = {}
  if (parsed.matrix) {
    const resolved = resolveMatrix(parsed.matrix)
    const clean: Record<string, Record<string, boolean>> = {}
    for (const cat of CATEGORIES) {
      clean[cat] = {}
      for (const ch of CHANNELS) clean[cat][ch] = resolved[cat][ch]
    }
    set.matrix = clean
  }

  try {
    if (parsed.discordWebhookUrl !== undefined) {
      set.discordWebhookUrl = cleanWebhook(parsed.discordWebhookUrl) ?? null
    }
    if (parsed.slackWebhookUrl !== undefined) {
      set.slackWebhookUrl = cleanWebhook(parsed.slackWebhookUrl) ?? null
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid webhook URL" },
      { status: 400 },
    )
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  await db
    .insert(notificationPreferences)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set })

  return NextResponse.json({ message: "Notification preferences saved" })
}
