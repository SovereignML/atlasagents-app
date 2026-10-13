/**
 * Pure helpers for scripts/schema-guard.ts, which runs before every
 * `drizzle-kit push --force` in the deploy entrypoint.
 *
 * `push --force` makes the live database match src/db/schema.ts, and that
 * includes dropping any table or column the schema doesn't define, with no
 * prompt. A table created outside this schema (production may hold an
 * ApiToken table from the unmerged mobile bearer-token work) would be dropped
 * with its data on the next start. The guard lists what a push would drop and
 * stops the push unless each drop is explicitly allowed.
 */

export type TableColumns = Map<string, Set<string>>

/** Tables and their columns from `drizzle-kit export` SQL. */
export function parseExportedSchema(sql: string): TableColumns {
  const tables: TableColumns = new Map()
  const re = /CREATE TABLE (?:IF NOT EXISTS )?"(?:public"\.")?([^"]+)" \(([\s\S]*?)\n\);/g
  for (const m of sql.matchAll(re)) {
    const cols = new Set<string>()
    for (const line of m[2].split("\n")) {
      const col = line.match(/^\s*"([^"]+)"\s/)
      if (col) cols.add(col[1])
    }
    tables.set(m[1], cols)
  }
  return tables
}

export type Drops = { tables: string[]; columns: string[] }

/**
 * What a push would drop: live tables the schema doesn't define, and live
 * columns of shared tables it doesn't define. `allow` lists accepted drops as
 * `Table` or `Table.column`.
 */
export function findDrops(schema: TableColumns, live: TableColumns, allow: Set<string>): Drops {
  const tables: string[] = []
  const columns: string[] = []
  for (const [table, liveCols] of live) {
    const schemaCols = schema.get(table)
    if (!schemaCols) {
      if (!allow.has(table)) tables.push(table)
      continue
    }
    for (const col of liveCols) {
      const key = `${table}.${col}`
      if (!schemaCols.has(col) && !allow.has(key)) columns.push(key)
    }
  }
  return { tables: tables.sort(), columns: columns.sort() }
}

export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
}
