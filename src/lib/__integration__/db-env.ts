// Side-effect module: redirect the ORM at the test database BEFORE `@/db` loads.
//
// Import this FIRST in every `.itest.ts`, ahead of any import that reaches
// `@/db` — `src/db/index.ts` reads `DATABASE_URL` at first import and caches a
// pool, so the redirect must be in place before then. ESM evaluates imports in
// source order, so listing this module above `@/db` guarantees it runs first.
//
// Why a module and not a bare `process.env.DATABASE_URL = ...` line at the top
// of each test file: ESM hoists all `import` declarations above ordinary
// statements, so a top-level assignment written "before" an import would still
// run AFTER `@/db` had already been evaluated. A side-effect import is the only
// ordering the language guarantees.
//
// The global setup (src/lib/__integration__/setup.ts) validates TEST_DATABASE_URL
// and pushes the schema, but it runs in a SEPARATE process and cannot mutate the
// worker's env — hence this per-worker propagation.

if (!process.env.DATABASE_URL) {
  const testUrl = process.env.TEST_DATABASE_URL
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests require a disposable " +
        "postgres database — see src/lib/__integration__/setup.ts.",
    )
  }
  process.env.DATABASE_URL = testUrl
}
