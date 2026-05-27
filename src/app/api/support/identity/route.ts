import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { chatwootIdentifierHash } from "@/lib/chatwoot"

// Returns the HMAC the Chatwoot widget needs to verify the logged-in user.
// `hash` is null when CHATWOOT_HMAC_TOKEN is unset (identity validation off).
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    identifier: session.user.id,
    hash: chatwootIdentifierHash(session.user.id),
  })
}
