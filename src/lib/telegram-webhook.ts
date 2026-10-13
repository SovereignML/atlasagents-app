import crypto from "node:crypto"

/**
 * Point a customer's Telegram bot at our central router (/tg/<webhookId>).
 *
 * The URL carries a random, non-secret id, never a token: token-bearing URLs
 * end up in proxy and CDN access logs. Telegram echoes `secret_token` back in
 * the X-Telegram-Bot-Api-Secret-Token header, so the router can reject spoofed
 * updates (src/app/tg/[webhookId]/route.ts).
 */

export type TelegramApiResult<T> = { ok: boolean; result?: T; description?: string }

export async function telegramApi<T>(
  token: string,
  method: string,
  body?: object,
): Promise<TelegramApiResult<T>> {
  const url = `https://api.telegram.org/bot${token}/${method}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  return (await res.json()) as TelegramApiResult<T>
}

export function gatewayBaseUrl(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_BASE_URL || "http://localhost:3000"
}

/**
 * Register the secure webhook for `botToken`. Returns the new id and secret to
 * persist (the secret encrypted), or the Telegram error.
 */
export async function registerTelegramWebhook(
  botToken: string,
): Promise<{ ok: true; webhookId: string; webhookSecret: string } | { ok: false; error: string }> {
  const webhookId = crypto.randomBytes(16).toString("hex")
  const webhookSecret = crypto.randomBytes(24).toString("hex")
  const setHook = await telegramApi<boolean>(botToken, "setWebhook", {
    url: `${gatewayBaseUrl()}/tg/${webhookId}`,
    allowed_updates: ["message"],
    secret_token: webhookSecret,
  })
  if (!setHook.ok) return { ok: false, error: setHook.description ?? "unknown" }
  return { ok: true, webhookId, webhookSecret }
}

/**
 * Whether the legacy /tg/<botToken> path may still serve this instance. Only
 * bots that were never moved to the secure path qualify, and the whole path
 * closes with TG_LEGACY_TOKEN_WEBHOOKS=off once
 * scripts/migrate-legacy-tg-webhooks.ts has moved every bot.
 */
export function legacyTokenWebhookAllowed(instance: { telegramWebhookId: string | null }): boolean {
  if (process.env.TG_LEGACY_TOKEN_WEBHOOKS?.trim().toLowerCase() === "off") return false
  return !instance.telegramWebhookId
}
