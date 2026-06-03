import { db, notifications, eq, and, desc, notInArray } from "@/db"
import type { NotificationCategory } from "../types"

// Keep at most this many notifications per user; older ones are pruned on insert.
const MAX_FEED = 100

// In-app channel: append a row to the user's notification feed (the bell).
export async function deliverInApp(params: {
  userId: string
  category: NotificationCategory
  type: string
  title: string
  message: string
  url?: string
  instanceId?: string
  meta?: Record<string, unknown>
}) {
  await db.insert(notifications).values({
    userId: params.userId,
    category: params.category,
    type: params.type,
    title: params.title,
    message: params.message,
    url: params.url ?? null,
    instanceId: params.instanceId ?? null,
    meta: params.meta ?? null,
  })

  // Prune the feed to the most recent MAX_FEED rows for this user.
  const keep = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.userId, params.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(MAX_FEED)

  await db
    .delete(notifications)
    .where(and(eq(notifications.userId, params.userId), notInArray(notifications.id, keep)))
}
