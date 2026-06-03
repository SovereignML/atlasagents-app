import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, cloudflareConnections, eq } from "@/db"
import { requireTeamManage } from "@/lib/team"
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

  // The Cloudflare connection is shared across the team — only owners/admins connect it.
  const team = await requireTeamManage(userId)
  if (!team) {
    return NextResponse.json(
      { error: "Only team owners and admins can connect an integration" },
      { status: 403 },
    )
  }

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
    where: eq(cloudflareConnections.teamId, team.teamId),
  })
  if (existing) {
    await db
      .update(cloudflareConnections)
      .set({ apiTokenEnc: encryptSecret(apiToken), userId })
      .where(eq(cloudflareConnections.teamId, team.teamId))
  } else {
    await db.insert(cloudflareConnections).values({
      teamId: team.teamId,
      userId,
      apiTokenEnc: encryptSecret(apiToken),
    })
  }

  await logAuditEvent({
    userId,
    teamId: team.teamId,
    action: "cloudflare.connect",
    targetType: "cloudflare_connection",
  })

  return NextResponse.json({ connected: true, zonesCount })
}
