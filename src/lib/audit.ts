import { db, auditLogs } from "@/db"
import { headers } from "next/headers"

export type AuditAction =
  | "instance.deploy"
  | "instance.restart"
  | "instance.stop"
  | "instance.delete"
  | "instance.agent_type_change"
  | "team.invite"
  | "team.accept"
  | "team.member_remove"
  | "team.role_change"
  | "team.switch"
  | "account.login"
  | "account.password_change"
  | "account.profile_update"
  | "billing.subscription.create"
  | "billing.subscription.cancel"
  | "admin.ban"
  | "admin.unban"
  | "admin.role_change"
  | "admin.impersonate"
  | "admin.stop_impersonation"
  | "admin.delete_user"
  | "admin.reset_password"

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
