import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { decryptSecret } from "@/lib/crypto-secret"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"

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

  if (!instance.openclawAdminEmail || !instance.openclawAdminPasswordEnc) {
    return NextResponse.json(
      { error: "Credentials not yet available. Provisioning may still be in progress." },
      { status: 409 }
    )
  }

  let password: string
  try {
    password = decryptSecret(instance.openclawAdminPasswordEnc)
  } catch {
    return NextResponse.json({ error: "Failed to decrypt credentials" }, { status: 500 })
  }

  let rootPassword: string | null = null
  if (instance.rootPasswordEnc) {
    try {
      rootPassword = decryptSecret(instance.rootPasswordEnc)
    } catch {
      // root password decryption failed — not fatal
    }
  }

  const access = buildPublicGatewayUrl({
    domain: instance.domain,
    managedSubdomain: instance.managedSubdomain,
    tlsStatus: instance.tlsStatus,
    ipAddress: instance.ipAddress,
  })

  return NextResponse.json({
    email: instance.openclawAdminEmail,
    password,
    rootPassword,
    sshCommand: instance.ipAddress ? `ssh root@${instance.ipAddress}` : null,
    gatewayUrl: access?.url ?? null,
    loginUrl: access?.url ?? null,
  })
}
