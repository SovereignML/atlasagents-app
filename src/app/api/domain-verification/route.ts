import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getOrCreateVerification } from "@/lib/domain-verify"

// GET /api/domain-verification?domain=foo.example
//
// Returns the TXT record the caller must publish. Idempotent — the nonce is
// stable for a given (user, domain) pair until verification succeeds.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const domain = req.nextUrl.searchParams.get("domain")
  if (!domain) {
    return NextResponse.json({ error: "domain query param required" }, { status: 400 })
  }
  if (!isValidDomain(domain)) {
    return NextResponse.json({ error: "invalid domain" }, { status: 400 })
  }

  const out = await getOrCreateVerification(session.user.id, domain)
  return NextResponse.json(out)
}

function isValidDomain(d: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d.trim())
}
