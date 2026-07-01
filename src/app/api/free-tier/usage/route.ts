import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getFreeTierUsage, FREE_LIFETIME_LIMIT } from "@/lib/free-tier"

// Drives the deploy wizard's Free-plan gating: hides Free once the lifetime
// allowance is spent and disables a runtime that already has a live free agent.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const usage = await getFreeTierUsage(session.user.id)
  return NextResponse.json({ ...usage, limit: FREE_LIFETIME_LIMIT })
}
