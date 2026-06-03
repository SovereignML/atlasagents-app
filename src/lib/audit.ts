import { db, auditLogs } from "@/db"
import { headers } from "next/headers"

/**
 * How long audit-log rows are kept, regardless of plan. Older rows are
 * deleted by the prune cron (`/api/audit-log/prune`) and the CSV export
 * (`/api/audit-log/export`) only covers this window.
 */
export const AUDIT_RETENTION_DAYS = 7

export type AuditAction =
  | "instance.deploy"
  | "instance.restart"
  | "instance.stop"
  | "instance.delete"
  | "instance.agent_type_change"
  | "instance.backup.create"
  | "instance.backup.restore"
  | "instance.backup.delete"
  | "instance.access.grant"
  | "instance.access.update"
  | "instance.access.revoke"
  | "team.ssh_key.add"
  | "team.ssh_key.remove"
  | "drive.connect"
  | "drive.disconnect"
  | "cloudflare.connect"
  | "cloudflare.disconnect"
  | "cloudflare.domain.set"
  | "cloudflare.domain.remove"
  | "team.invite"
  | "team.accept"
  | "team.member_remove"
  | "team.role_change"
  | "team.switch"
  | "team.create"
  | "branding.update"
  | "branding.asset.upload"
  | "branding.domain.set"
  | "branding.domain.verify"
  | "branding.domain.remove"
  | "account.login"
  | "account.password_change"
  | "account.profile_update"
  | "account.deletion_request"
  | "account.deletion_request.cancel"
  | "billing.subscription.create"
  | "billing.subscription.cancel"
  | "support.ticket"
  | "support.ticket.reply"
  | "support.ticket.status"
  | "admin.ban"
  | "admin.unban"
  | "admin.role_change"
  | "admin.impersonate"
  | "admin.stop_impersonation"
  | "admin.delete_user"
  | "admin.deletion_request.approve"
  | "admin.deletion_request.deny"
  | "admin.reset_password"
  | "admin.provider.update"
  | "admin.provider.billing_update"
  | "admin.provider.health_check"
  | "admin.credit_adjust"
  | "admin.whitelabel_toggle"
  | "admin.backup.config"
  | "admin.backup.create"
  | "admin.backup.delete"
  | "admin.backup.restore"
  | "tenant.customer.create"
  | "tenant.customer.update"
  | "tenant.customer.suspend"
  | "tenant.chatwoot.update"
  | "tenant.connect.update"
  | "tenant.support.reply"
  | "tenant.support.status"
  | "tenant.impersonate"

export async function logAuditEvent(params: {
  userId: string
  action: AuditAction
  teamId?: string | null
  targetType?: string
  targetId?: string
  targetLabel?: string
  meta?: Record<string, unknown>
}) {
  let ipAddress: string | null = null
  let userAgent: string | null = null
  try {
    const h = await headers()
    ipAddress =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null
    userAgent = h.get("user-agent")
  } catch {
    // headers() unavailable outside request context
  }

  try {
    await db.insert(auditLogs).values({
      userId: params.userId,
      teamId: params.teamId ?? null,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      targetLabel: params.targetLabel ?? null,
      ipAddress,
      userAgent,
      meta: (params.meta as never) ?? null,
    })
  } catch (err) {
    console.error("[audit] failed to write audit event:", err)
  }
}
