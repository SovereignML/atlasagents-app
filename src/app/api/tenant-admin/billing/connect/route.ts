import { NextResponse } from "next/server"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import {
  createConnectAccount,
  createAccountOnboardingLink,
  refreshConnectStatus,
} from "@/lib/stripe-connect"

function baseUrl(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
}

// GET — current connected-account status (charges/payouts enabled).
export async function GET() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const status = await refreshConnectStatus(admin.tenantTeamId)
  return NextResponse.json(status)
}

// POST — create (or reuse) the tenant's connected account and return a
// Stripe-hosted onboarding link.
export async function POST(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const accountId = await createConnectAccount(admin.tenantTeamId)
  const base = baseUrl(req)
  const url = await createAccountOnboardingLink(accountId, {
    refreshUrl: `${base}/tenant-admin/settings?connect=refresh`,
    returnUrl: `${base}/tenant-admin/settings?connect=done`,
  })
  return NextResponse.json({ url })
}
