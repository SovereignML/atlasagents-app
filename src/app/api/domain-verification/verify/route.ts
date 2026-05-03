import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { verifyDomain } from "@/lib/domain-verify"

// POST /api/domain-verification/verify { domain }
//
// Resolves the TXT record and stamps verifiedAt on match. Returns 200 on
// success, 422 if the TXT record is absent or mismatched, 404 if no nonce
// has been requested for this (user, domain).
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { domain?: string }
  const domain = body.domain?.trim()
  if (!domain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 })
  }

  const result = await verifyDomain(session.user.id, domain)
  if (result.verified) {
    return NextResponse.json({ verified: true })
  }
  const status = result.reason?.startsWith("no verification pending") ? 404 : 422
  return NextResponse.json({ verified: false, reason: result.reason }, { status })
}
