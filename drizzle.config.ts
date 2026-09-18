import { defineConfig } from "drizzle-kit"

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Run `node --env-file=.env node_modules/drizzle-kit/bin.cjs push` " +
      "or use `npm run db:push` which passes --env-file.",
  )
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  // Output dir for `npm run db:generate`. NOTE: generate/migrate are NOT the
  // shipping path today, and this comment used to claim the opposite.
  // `drizzle-kit push` is authoritative — CLAUDE.md and NOT-TO-DO.md both
  // forbid running generate/migrate against a real database, because there is
  // no populated migrations journal, so `migrate` would try to replay
  // everything and fail on already-existing columns. The deploy entrypoint
  // runs `push --force` non-fatally. If versioned migrations ever become the
  // real path, that decision has to be made in those two files first.
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  verbose: true,
  // false = apply schema without a TTY prompt (CI, scripts). Review diffs before push in prod.
  strict: false,
})
