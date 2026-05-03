// Drizzle client + pg.Pool singleton.
//
// One module, one connection pool, one `db` handle. Importable as
// `@/db` from anywhere. Throws loudly at module load if DATABASE_URL
// is missing — no silent "connection string: undefined" failures.

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. This project loads exactly one env file — " +
      "`.env` at the repo root. Run `bash scripts/bootstrap-pg.sh` or " +
      "check `deploy/README.md`.",
  )
}

const globalForDb = globalThis as unknown as {
  __pgPool?: Pool
  __db?: ReturnType<typeof drizzle<typeof schema>>
}

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Conservative defaults — the app is fork-mode pm2 with 1 worker.
    max: 10,
    idleTimeoutMillis: 30_000,
  })

export const db =
  globalForDb.__db ??
  drizzle(pool, {
    schema,
    logger: process.env.NODE_ENV === "development",
  })

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgPool = pool
  globalForDb.__db = db
}

// Re-export the schema so call sites can do:
//   import { db, users, instances, eq } from "@/db"
export * from "./schema"
export {
  eq,
  and,
  or,
  not,
  ne,
  desc,
  asc,
  inArray,
  notInArray,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  isNull,
  isNotNull,
  sql,
} from "drizzle-orm"
