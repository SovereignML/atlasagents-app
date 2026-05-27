import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, cloudflareConnections, eq } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import { encryptSecret } from "@/lib/crypto-secret"
import { verifyToken, listZones } from "@/lib/cloudflare"
import { cloudflareErrorResponse } from "@/lib/cloudflare-errors"

/**
 * POST /api/integrations/cloudflare/connect
 *
 * Body: { token: string } — a scoped Cloudflare API token (Zone:Read,
 * Zone:DNS:Edit, and ideally Zone Settings:Edit). We verify it's active, smoke
 * -test Zone:Read by listing zones, then store it encrypted. One per user.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  const apiToken = body.token?.trim()
  if (!apiToken) {
    return NextResponse.json({ error: "Missing API token" }, { status: 400 })
  }

  let zonesCount = 0
  try {
    const verified = await verifyToken(apiToken)
    if (verified.status !== "active") {
      return NextResponse.json(
        { error: "Cloudflare token is not active.", code: "cloudflare_reauth" },
        { status: 409 },
      )
    }
    // Confirms Zone:Read actually works (verify alone doesn't prove scopes).
    const zones = await listZones(apiToken)
    zonesCount = zones.length
  } catch (err) {
    const mapped = cloudflareErrorResponse(err)
    if (mapped) return mapped
    console.error("[cloudflare] connect verify failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: "Could not verify the Cloudflare token." },
      { status: 502 },
    )
  }

  const existing = await db.query.cloudflareConnections.findFirst({
    where: eq(cloudflareConnections.userId, userId),
  })
  if (existing) {
    await db
      .update(cloudflareConnections)
      .set({ apiTokenEnc: encryptSecret(apiToken) })
      .where(eq(cloudflareConnections.userId, userId))
  } else {
    await db.insert(cloudflareConnections).values({
      userId,
      apiTokenEnc: encryptSecret(apiToken),
    })
  }

  await logAuditEvent({
    userId,
    action: "cloudflare.connect",
    targetType: "cloudflare_connection",
  })

  return NextResponse.json({ connected: true, zonesCount })
}
