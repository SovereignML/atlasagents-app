import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { availableRuntimesFor } from "@/lib/runtime-access"

// Drives which engines the deploy wizards offer. Beta engines (Claude Code,
// Codex) appear only with CLI_RUNTIMES_ENABLED=true, or for platform admins.
// The deploy routes enforce the same rule — see runtimeDeployDenial.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ available: availableRuntimesFor(session) })
}
