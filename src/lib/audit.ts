import { db, auditLogs } from "@/db"
import { headers } from "next/headers"

/**
 * How long audit-log rows are kept, regardless of plan. Older rows are
 * deleted by the prune cron (`/api/audit-log/prune`) and the CSV export
 * (`/api/audit-log/export`) only covers this window.
 */
export const AUDIT_RETENTION_DAYS = 7

/**
 * How long *resolved* admin notifications are kept. Unresolved notifications
 * are never auto-pruned (they're actionable). Deleted by the prune cron
 * (`/api/admin/notifications/prune`).
 */
export const ADMIN_NOTIFICATION_RETENTION_DAYS = 30

export type AuditAction =
  | "instance.deploy"
  | "instance.restart"
  | "instance.restart_caddy"
  | "instance.stop"
  | "instance.delete"
  | "instance.rename"
  | "instance.agent_type_change"
  | "instance.custom_instructions_change"
  | "instance.tools_change"
  | "instance.skills_change"
  | "instance.knowledge_add"
  | "instance.model_change"
  | "instance.byos_key_switch"
  | "instance.file_save"
  | "instance.file_delete"
  | "instance.file_mkdir"
  | "instance.file_rename"
  | "instance.file_upload"
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
  | "team.delete"
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
  | "admin.set_free_limit"
  | "admin.provider.update"
  | "admin.provider.billing_update"
  | "admin.provider.health_check"
  | "admin.credit_adjust"
  | "admin.subscription.cancel"
  | "admin.subscription.cancel_at_period_end"
  | "admin.subscription.resume"
  | "admin.subscription.set_status"
  | "admin.subscription.delete"
  | "admin.whitelabel_toggle"
  | "admin.backup.config"
  | "admin.backup.create"
  | "admin.backup.delete"
  | "admin.backup.restore"
  | "admin.warm_pool.destroy"
  | "admin.models.reset"
  | "tenant.customer.create"
  | "tenant.customer.update"
  | "tenant.customer.suspend"
  | "tenant.chatwoot.update"
  | "tenant.connect.update"
  | "tenant.support.reply"
  | "tenant.support.status"
  | "tenant.impersonate"
  | "tenant.act_as.start"
  | "tenant.act_as.stop"
  | "tenant.plan.create"
  | "tenant.plan.archive"
  | "tenant.checkout.create"

export async function logAuditEvent(params: {
  /** The REAL actor who performed the action (the row's userId). */
  userId: string
  action: AuditAction
  teamId?: string | null
  targetType?: string
  targetId?: string
  targetLabel?: string
  /**
   * When the actor operated "on behalf of" another identity — e.g. a tenant
   * admin acting as a child-team owner, or a platform admin impersonating — the
   * effective user id. Folded into `meta.onBehalfOf` so the actor↔target
   * distinction survives without a schema change.
   */
  onBehalfOfUserId?: string | null
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

  const meta = params.onBehalfOfUserId
    ? { ...(params.meta ?? {}), onBehalfOf: params.onBehalfOfUserId }
    : params.meta

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
      meta: (meta as never) ?? null,
    })
  } catch (err) {
    console.error("[audit] failed to write audit event:", err)
  }
}
