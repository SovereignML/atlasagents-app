import { db, eq, and, teamBrandingAssets } from "@/db"
import { isAssetKind } from "@/lib/branding-assets"

// Public read of an uploaded brand asset (logos/favicons aren't secret). Served
// with a long immutable cache (the teamBranding URL is cache-busted by ?v on
// update) and a strict sandbox so an uploaded SVG can't execute scripts even on
// direct navigation. Not in the proxy auth matcher → reachable without a session.
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ teamId: string; kind: string }> },
) {
  const { teamId, kind } = await params
  if (!isAssetKind(kind)) return new Response(null, { status: 404 })

  const asset = await db.query.teamBrandingAssets.findFirst({
    where: and(
      eq(teamBrandingAssets.teamId, teamId),
      eq(teamBrandingAssets.kind, kind),
    ),
    columns: { contentType: true, dataBase64: true },
  })
  if (!asset) return new Response(null, { status: 404 })

  const body = Buffer.from(asset.dataBase64, "base64")
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
}
