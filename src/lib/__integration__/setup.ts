// Global setup for the DB-backed integration suite (vitest.integration.config.ts).
//
// Responsibilities, in order:
//   1. Require TEST_DATABASE_URL — refuse to run without it.
//   2. Safety guard — refuse unless the database NAME contains "test". Both the
//      schema push (`drizzle-kit push --force`) and the per-test truncation are
//      DESTRUCTIVE; this guard is the last line of defense against pointing the
//      suite at a dev or prod database.
//   3. Redirect the whole stack — set process.env.DATABASE_URL to the test URL.
//      NOTE: globalSetup runs in a SEPARATE process from the test workers, so
//      this assignment does NOT reach them. Each `.itest.ts` file therefore also
//      sets process.env.DATABASE_URL at its very top, BEFORE importing `@/db`
//      (src/db/index.ts reads the env at first import). This setup's own
//      assignment only matters for the push below.
//   4. Apply the schema with `drizzle-kit push --force` (push-not-migrate
//      doctrine, mirroring scripts/bootstrap-pg.sh), passing DATABASE_URL via a
//      child-env override — never shell-interpolate the URL.

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

/** Extract the database name from a postgres connection URL. */
function databaseName(url: string): string {
  // `new URL` handles postgres:// and postgresql://; pathname is "/<dbname>".
  const { pathname } = new URL(url)
  return pathname.replace(/^\//, "")
}

export async function setup() {
  const testUrl = process.env.TEST_DATABASE_URL
  if (!testUrl) {
    throw new Error(
      "Set TEST_DATABASE_URL to a disposable postgres database " +
        "(its name must contain 'test'). Integration tests run against a REAL " +
        "database and will truncate/overwrite it.",
    )
  }

  const dbName = databaseName(testUrl)
  if (!dbName.includes("test")) {
    throw new Error(
      `Refusing to run integration tests: TEST_DATABASE_URL database name ` +
        `"${dbName}" does not contain "test". This suite is destructive ` +
        `(drizzle-kit push --force + table truncation) and must only ever ` +
        `target a disposable test database.`,
    )
  }

  // Redirect the ORM for anything imported in THIS process (see header note).
  process.env.DATABASE_URL = testUrl

  // Apply the schema to the test DB. `--force` skips interactive confirmation;
  // the schema is the source of truth. DATABASE_URL is passed via the child
  // env override rather than the shell, so the URL is never interpolated.
  const drizzleKit = fileURLToPath(
    new URL("../../../node_modules/drizzle-kit/bin.cjs", import.meta.url),
  )
  execFileSync("node", [drizzleKit, "push", "--force"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  })
}
