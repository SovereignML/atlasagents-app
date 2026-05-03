import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { decryptSecret } from "@/lib/crypto-secret"

export async function GET(
  _req: NextRequest,
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
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (!isAdmin && instance.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  if (!instance.gatewayTokenEnc) {
    return NextResponse.json(
      { error: "Gateway token not yet available. Provisioning may still be in progress." },
      { status: 409 }
    )
  }

  let gatewayToken: string
  try {
    gatewayToken = decryptSecret(instance.gatewayTokenEnc)
  } catch {
    return NextResponse.json({ error: "Failed to decrypt gateway token" }, { status: 500 })
  }

  return NextResponse.json({ gatewayToken })
}
