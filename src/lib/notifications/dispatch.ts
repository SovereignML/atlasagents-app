// Central notification dispatcher. Business code calls `notify(...)`; this
// resolves the user's per-category × channel matrix and fans out to every
// enabled + configured channel. It NEVER throws — a notification failure must
// not break the business path that emitted it.

import { db, users, notificationPreferences, eq } from "@/db"
import { BRANDING } from "@/configs/branding"
import { resolveMatrix, type NotificationCategory } from "./types"
import { deliverInApp } from "./channels/inapp"
import { deliverEmail } from "./channels/email"
import { deliverTelegram } from "./channels/telegram"
import { deliverDiscord } from "./channels/discord"
import { deliverSlack } from "./channels/slack"

export type NotifyParams = {
  userId: string
  category: NotificationCategory
  type: string
  title: string
  message: string
  url?: string // relative ("/dashboard/...") or absolute; made absolute for external channels
  instanceId?: string
  meta?: Record<string, unknown>
}

export async function notify(params: NotifyParams): Promise<void> {
  try {
    const [user, prefs] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, params.userId),
        columns: { email: true },
      }),
      db.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.userId, params.userId),
      }),
    ])

    const row = resolveMatrix(prefs?.matrix)[params.category]

    // External channels need an absolute URL; in-app keeps the relative path.
    const absUrl = params.url
      ? params.url.startsWith("http")
        ? params.url
        : `${BRANDING.appUrl}${params.url}`
      : undefined

    const tasks: Promise<unknown>[] = []

    if (row.inApp) {
      tasks.push(
        deliverInApp({
          userId: params.userId,
          category: params.category,
          type: params.type,
          title: params.title,
          message: params.message,
          url: params.url,
          instanceId: params.instanceId,
          meta: params.meta,
        }),
      )
    }
    if (row.email && user?.email) {
      tasks.push(
        deliverEmail({ to: user.email, title: params.title, message: params.message, url: absUrl }),
      )
    }
    if (row.telegram && prefs?.telegramChatId) {
      tasks.push(
        deliverTelegram({
          chatId: prefs.telegramChatId,
          title: params.title,
          message: params.message,
          url: absUrl,
        }),
      )
    }
    if (row.discord && prefs?.discordWebhookUrl) {
      tasks.push(
        deliverDiscord({
          webhookUrl: prefs.discordWebhookUrl,
          title: params.title,
          message: params.message,
          url: absUrl,
        }),
      )
    }
    if (row.slack && prefs?.slackWebhookUrl) {
      tasks.push(
        deliverSlack({
          webhookUrl: prefs.slackWebhookUrl,
          title: params.title,
          message: params.message,
          url: absUrl,
        }),
      )
    }

    const results = await Promise.allSettled(tasks)
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn(`[notify] channel error (${params.type}):`, r.reason)
      }
    }
  } catch (err) {
    console.warn(`[notify] dispatch failed for user ${params.userId} (${params.type}):`, err)
  }
}
