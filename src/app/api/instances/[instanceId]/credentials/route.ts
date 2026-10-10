import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { decryptSecret } from "@/lib/crypto-secret"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { runtimeCaps } from "@/lib/runtimes/labels"

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
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Admin login credentials are secrets — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  // Hermes authenticates with a single bearer token (API_SERVER_KEY), not an
  // admin email/password. The exception is when the Open WebUI sidecar is
  // enabled: then the openclawAdmin* columns hold the Open WebUI login, which
  // we surface below like any other admin login. Without the sidecar there is
  // no admin login at all, so tell the dashboard to hide the card.
  if (!runtimeCaps(instance.runtime).nativeAdminLogin && !instance.webuiEnabled) {
    return NextResponse.json(
      {
        error: "Hermes runtime has no admin login. Use the gateway token instead.",
        code: "NO_ADMIN_FOR_HERMES",
      },
      { status: 409 }
    )
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
