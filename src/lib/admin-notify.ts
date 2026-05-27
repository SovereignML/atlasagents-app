import { db, adminNotifications } from "@/db"

export async function createAdminNotification(params: {
  type: string
  userId: string
  instanceId?: string
  message: string
  meta?: Record<string, unknown>
}) {
  await db.insert(adminNotifications).values({
    type: params.type,
    userId: params.userId,
    instanceId: params.instanceId ?? null,
    message: params.message,
    meta: params.meta ?? null,
  })
}
