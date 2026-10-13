// Runs before `drizzle-kit push --force` in scripts/deploy-entrypoint.sh.
// Lists every table and column in the live database that src/db/schema.ts does
// not define, which push --force would DROP without asking, and exits 3 if any
// isn't explicitly allowed. The entrypoint then skips the push and starts the
// server on the existing schema. See src/lib/schema-guard.ts.
//
// Usage (reads DATABASE_URL):
//   node --env-file=.env --import tsx scripts/schema-guard.ts
//
// To accept a drop, back the data up first, then list it:
//   SCHEMA_GUARD_ALLOW_DROP="ApiToken,User.legacyFlag"
// or, better, add the table to src/db/schema.ts so it is kept.
//
// Exit codes: 0 nothing would be dropped, 3 drops found, 1 the check failed.

import { execFileSync } from "node:child_process"
import { Client } from "pg"

import { findDrops, parseAllowList, parseExportedSchema, type TableColumns } from "@/lib/schema-guard"

async function liveSchema(url: string): Promise<TableColumns> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(`
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    `)
    const out: TableColumns = new Map()
    for (const r of rows) {
      if (!out.has(r.table_name)) out.set(r.table_name, new Set())
      out.get(r.table_name)!.add(r.column_name)
    }
    return out
  } finally {
    await client.end()
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("[schema-guard] DATABASE_URL is not set.")
    return 1
  }
  const exported = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  })
  const schema = parseExportedSchema(exported)
  if (schema.size === 0) {
    console.error("[schema-guard] drizzle-kit export returned no tables; refusing to judge.")
    return 1
  }
  const drops = findDrops(schema, await liveSchema(url), parseAllowList(process.env.SCHEMA_GUARD_ALLOW_DROP))
  if (drops.tables.length === 0 && drops.columns.length === 0) {
    console.log("[schema-guard] push would drop nothing.")
    return 0
  }
  console.error("[schema-guard] drizzle-kit push --force would DROP data that src/db/schema.ts doesn't define:")
  for (const t of drops.tables) console.error(`  table  ${t}`)
  for (const c of drops.columns) console.error(`  column ${c}`)
  console.error(
    "[schema-guard] Add them to the schema to keep them, or back them up and list them in " +
      "SCHEMA_GUARD_ALLOW_DROP (comma-separated Table or Table.column) to let the push drop them.",
  )
  return 3
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[schema-guard] check failed:", err)
    process.exit(1)
  })
