import { defineConfig } from "drizzle-kit"

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Run `node --env-file=.env node_modules/drizzle-kit/bin.cjs push` " +
      "or use `npm run db:push` which passes --env-file.",
  )
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  verbose: true,
  // false = apply schema without a TTY prompt (CI, scripts). Review diffs before push in prod.
  strict: false,
})
