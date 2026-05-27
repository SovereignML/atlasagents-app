import { defineConfig } from "drizzle-kit"

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Run `node --env-file=.env node_modules/drizzle-kit/bin.cjs push` " +
      "or use `npm run db:push` which passes --env-file.",
  )
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  // Versioned migrations live here. `npm run db:generate` writes SQL +
  // snapshot into this directory; `npm run db:migrate` applies them.
  // `npm run db:push` is the legacy direct-sync path — keep using it for
  // local dev iteration, but production schema changes should ship a
  // generated migration so they're reviewable and reversible.
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  verbose: true,
  // false = apply schema without a TTY prompt (CI, scripts). Review diffs before push in prod.
  strict: false,
})
