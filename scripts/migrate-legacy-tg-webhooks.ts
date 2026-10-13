// Move Telegram bots still on the legacy /tg/<botToken> webhook to the secure
// /tg/<webhookId> path with a secret_token, the same registration the connect
// route does (src/lib/telegram-webhook.ts). The legacy path put the bot token,
// a credential, into every access and proxy log line.
//
// Dry run by default: lists the bots that would move. --apply re-registers
// each with Telegram and saves the new webhook id and encrypted secret. Safe to
// re-run; a bot that has moved is skipped.
//
// Usage (on the server, which holds the real .env):
//   node --env-file=.env --import tsx scripts/migrate-legacy-tg-webhooks.ts
//   node --env-file=.env --import tsx scripts/migrate-legacy-tg-webhooks.ts --apply
//
// Once it reports nothing left, set TG_LEGACY_TOKEN_WEBHOOKS=off to close the
// legacy path for good.

import { db, instances, eq, and, ne, isNull, isNotNull } from "@/db"
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret"
import { registerTelegramWebhook } from "@/lib/telegram-webhook"

const APPLY = process.argv.includes("--apply")

async function main() {
  const rows = await db.query.instances.findMany({
    where: and(
      isNotNull(instances.telegramBotTokenEnc),
      isNull(instances.telegramWebhookId),
      ne(instances.status, "deleted"),
    ),
    columns: { id: true, name: true, status: true, telegramBotTokenEnc: true },
  })
  console.log(`${rows.length} bot(s) on the legacy token webhook path${APPLY ? "" : " (dry run)"}`)

  let failed = 0
  for (const row of rows) {
    if (!APPLY) {
      console.log(`  would move ${row.id} (${row.name}, ${row.status})`)
      continue
    }
    let botToken: string
    try {
      botToken = decryptSecret(row.telegramBotTokenEnc!)
    } catch {
      console.error(`  ${row.id}: could not decrypt the Telegram token, skipped`)
      failed++
      continue
    }
    const hook = await registerTelegramWebhook(botToken)
    if (!hook.ok) {
      console.error(`  ${row.id}: Telegram setWebhook failed: ${hook.error}`)
      failed++
      continue
    }
    await db
      .update(instances)
      .set({
        telegramWebhookId: hook.webhookId,
        telegramWebhookSecretEnc: encryptSecret(hook.webhookSecret),
      })
      .where(eq(instances.id, row.id))
    console.log(`  moved ${row.id} (${row.name})`)
  }

  if (failed > 0) {
    console.error(`${failed} bot(s) failed; fix and re-run before setting TG_LEGACY_TOKEN_WEBHOOKS=off.`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
