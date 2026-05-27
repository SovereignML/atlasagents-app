import { NextResponse } from "next/server"
import { db, eq, and, isNotNull, teamBranding } from "@/db"
import { teamHasWhiteLabel } from "@/lib/white-label"

// Caddy on-demand-TLS "ask" endpoint. Before issuing a Let's Encrypt cert for
// an incoming SNI, Caddy GETs this with ?domain=<host>; a 200 authorizes, any
// non-2xx denies. This is the single chokepoint that ties cert issuance to a
// verified custom domain on a currently-entitled team — without it, anyone
// could point a domain at us and trigger unbounded cert issuance (DoS).
//
// Intentionally OUTSIDE the src/proxy.ts auth matcher (session-less). Caddy
// calls it over loopback; set TLS_AUTHORIZE_SECRET to require a shared header
// in addition (configure the same value in deploy/Caddyfile).
export const dynamic = "force-dynamic"

function deny(status = 404) {
  return new NextResponse(null, { status })
}

export async function GET(req: Request) {
  const secret = process.env.TLS_AUTHORIZE_SECRET
  if (secret && req.headers.get("x-tls-authorize-secret") !== secret) {
    return deny(403)
  }

  const url = new URL(req.url)
  const domain = url.searchParams.get("domain")?.trim().toLowerCase()
  if (!domain) return deny(400)

  const row = await db.query.teamBranding.findFirst({
    where: and(
      eq(teamBranding.customDomain, domain),
      isNotNull(teamBranding.domainVerifiedAt),
    ),
    columns: { teamId: true },
  })
  if (!row) return deny(404)

  if (!(await teamHasWhiteLabel(row.teamId))) return deny(403)

  return new NextResponse(null, { status: 200 })
}
