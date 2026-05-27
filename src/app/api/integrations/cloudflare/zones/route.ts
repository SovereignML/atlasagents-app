import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getCloudflareTokenForUser, listZones } from "@/lib/cloudflare"
import { cloudflareErrorResponse } from "@/lib/cloudflare-errors"

/**
 * GET /api/integrations/cloudflare/zones
 *
 * Lists the zones (domains) the connected token can manage, for the domain
 * picker. 409 cloudflare_not_connected / cloudflare_reauth drive the UI.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const token = await getCloudflareTokenForUser(session.user.id)
    const zones = await listZones(token)
    return NextResponse.json({
      zones: zones.map((z) => ({ id: z.id, name: z.name, status: z.status })),
    })
  } catch (err) {
    const mapped = cloudflareErrorResponse(err)
    if (mapped) return mapped
    console.error("[cloudflare] list zones failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Could not list Cloudflare zones." }, { status: 502 })
  }
}
