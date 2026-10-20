// Move every running agent from Open WebUI to AgentWebUI Lite.
//
// Agents made before Lite (Instance.chatUi NULL) still run Open WebUI. Any
// reprovision moves one over on its own (reprovisionBotEnv → migrateChatUiToLite),
// but an agent nobody touches would keep Open WebUI forever. This moves them all
// now, one at a time:
//   - installs Lite (and the engine's ACP side) on the box;
//   - only then stops and deletes Open WebUI, its unit, venv, env and user —
//     ITS CHAT HISTORY IS DELETED (agreed: no export);
//   - starts Lite on the same port, so Caddy needs no change;
//   - marks the row chatUi = "agentwebui-lite".
// It runs the normal reprovision, so the agent's gateway restarts once too
// (a few seconds; open chats and bot conversations reconnect).
//
// Lite is installed before Open WebUI is touched: a box where the install fails
// keeps its working chat UI, is listed as FAILED, and is retried on the next run.
//
// Usage:
//   node --env-file=.env --import tsx scripts/migrate-chat-ui-to-lite.ts             # dry run: list only
//   node --env-file=.env --import tsx scripts/migrate-chat-ui-to-lite.ts --apply
//   node --env-file=.env --import tsx scripts/migrate-chat-ui-to-lite.ts --apply --instance <id>
//
// DEFAULTS TO DRY RUN, which only reads the database.

import { db, instances, eq, and, inArray, isNotNull, isNull } from "@/db"
import { reprovisionBotEnv } from "@/lib/provisioner"
import { runsLite } from "@/lib/runtimes/agentwebui-lite"

const APPLY = process.argv.includes("--apply")
const onlyIdx = process.argv.indexOf("--instance")
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null

async function main() {
  const rows = await db.query.instances.findMany({
    where: and(
      eq(instances.status, "running"),
      eq(instances.webuiEnabled, true),
      isNull(instances.chatUi),
      inArray(instances.deploymentTarget, ["vps", "byos"]),
      isNotNull(instances.ipAddress),
      ...(ONLY ? [eq(instances.id, ONLY)] : []),
    ),
  })
  console.log(
    `${rows.length} running agent(s) still on Open WebUI${APPLY ? "" : " — DRY RUN; pass --apply to move them"}`,
  )
  let failed = 0
  for (const row of rows) {
    const label = `  ${row.id}  ${row.runtime ?? "openclaw"}  ${row.managedSubdomain ?? row.domain ?? row.ipAddress}`
    if (!APPLY) {
      console.log(label)
      continue
    }
    try {
      await reprovisionBotEnv(row)
      const after = await db.query.instances.findFirst({
        where: eq(instances.id, row.id),
        columns: { chatUi: true },
      })
      if (after && runsLite(after)) {
        console.log(`${label}  moved`)
      } else {
        failed++
        console.log(`${label}  FAILED: still on Open WebUI (see the agent's logs)`)
      }
    } catch (err) {
      failed++
      console.log(`${label}  FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failed) console.log(`${failed} agent(s) were not moved; their Open WebUI still works. Run again to retry.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
