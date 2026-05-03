import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { auth } from "@/auth"
import { db, instances, instanceLogs, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { reprovisionBotEnv } from "@/lib/provisioner"

async function requireOwner(instanceId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(session.user.id, instanceId),
  })
  if (!instance) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  if (!isAdmin && instance.userId !== session.user.id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  if (instance.status === "deleted") {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  return { instance }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params
  const check = await requireOwner(instanceId)
  if ("error" in check) return check.error
  return NextResponse.json({ botToken: check.instance.botToken })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params
  const check = await requireOwner(instanceId)
  if ("error" in check) return check.error

  const newToken = "sk_bot_" + crypto.randomBytes(24).toString("hex")
  const [updated] = await db
    .update(instances)
    .set({ botToken: newToken })
    .where(eq(instances.id, instanceId))
    .returning()

  // Push new env to the running container so the new token takes effect.
  try {
    await reprovisionBotEnv(updated)
  } catch (err) {
    console.warn(`[token] reprovision after rotate failed for ${instanceId}:`, err)
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: "Bot token rotated.",
  })

  return NextResponse.json({ botToken: newToken })
}
