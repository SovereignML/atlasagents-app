import { NextResponse } from "next/server"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { resolveChatwootForTeam, listConversations } from "@/lib/chatwoot"

// GET — list the tenant's Chatwoot conversations for the agent-facing inbox.
// ?status=open|resolved|pending|all (default open).
export async function GET(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const cfg = await resolveChatwootForTeam(admin.tenantTeamId)
  if (!cfg) {
    return NextResponse.json({ configured: false, conversations: [] })
  }

  const url = new URL(req.url)
  const statusParam = url.searchParams.get("status")
  const status =
    statusParam === "resolved" || statusParam === "pending" || statusParam === "all"
      ? statusParam
      : "open"

  const conversations = await listConversations(cfg, { status })
  return NextResponse.json({ configured: true, conversations })
}
