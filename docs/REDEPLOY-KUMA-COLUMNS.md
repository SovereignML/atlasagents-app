# Redeploy notes — `kuma*` Instance columns (2026-05-30)

A fix for the `/dashboard` runtime error. Read this before the next production deploy.

---

## What broke

`src/app/dashboard/page.tsx` runs `db.query.instances.findMany({ with: { region, serverConfig } })`,
which SELECTs **every** column in the `instances` Drizzle model. Six columns existed in
`src/db/schema.ts` (lines 392–397) but **not in the database**, so Postgres rejected the query.
The Next.js error was truncated — the real cause was `column "kumaMonitorId" does not exist`.

Missing columns (the Uptime-Kuma monitoring fields, all nullable):

| Column | Type |
| --- | --- |
| `kumaMonitorId` | `integer` |
| `kumaStatus` | `text` |
| `kumaResponseTimeMs` | `integer` |
| `kumaUptimeRatio` | `double precision` |
| `kumaCertDaysRemaining` | `integer` |
| `kumaCheckedAt` | `timestamp` |

## Why `db:migrate` could not be used

`drizzle.__drizzle_migrations` has **0 rows** — these databases were built entirely with `db:push`,
never with tracked migrations. So `db:migrate` replays from `0000`, hits `CREATE TABLE` on
already-existing tables, and aborts (it hangs on `applying migrations...`). The schema is
push-managed; the versioned migration files have never actually been applied.

## What was done (local dev DB only)

Applied the six additive, nullable columns directly — the exact definitions from the reviewed
migration — using idempotent `ADD COLUMN IF NOT EXISTS`. Verified all six columns and re-ran the
dashboard query (succeeds). **Production was not touched.** No commit was made.

---

## ✅ TODO on redeployment

- [ ] **Apply the columns to the production / remote DB.** Run against the prod `DATABASE_URL`
      (idempotent, additive, non-destructive — safe to run more than once):

      ```sql
      ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "kumaMonitorId" integer;
      ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "kumaStatus" text;
      ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "kumaResponseTimeMs" integer;
      ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "kumaUptimeRatio" double precision;
      ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "kumaCertDaysRemaining" integer;
      ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "kumaCheckedAt" timestamp;
      ```

      e.g. `psql "$PROD_DATABASE_URL" -f -` (paste the block) or run from the DB console.

- [ ] **Verify after applying:** reload `/dashboard` on prod — it should render without the
      "Failed query" error. Optional check: `\d "Instance"` shows the six `kuma*` columns.

- [ ] **Decide what to do with the generated migration files.** `npm run db:generate` produced
      `drizzle/migrations/0007_complex_genesis.sql` + `meta/0007_snapshot.json` and updated
      `_journal.json`. The 0007 snapshot correctly reflects `schema.ts` (so future `db:generate`
      reports no drift), **but** the `.sql` also contains `CREATE TABLE "TeamBranding"` /
      `"TeamBrandingAsset"` for tables `db:push` already created — so it only applies cleanly on a
      truly fresh DB, never via `db:migrate` on the existing push-managed DBs. Either keep it
      (harmless; closes snapshot drift) or delete the three generated files.

- [ ] **(Bigger, separate task) Adopt tracked migrations.** Migrations are not tracked on any of
      these DBs. To use reviewable `db:migrate` going forward, baseline the journal once — record
      `0000`–`00xx` as already-applied in `__drizzle_migrations` without re-running them. Plan this
      separately; it is out of scope for this fix.

---

## Reference

- Failing query / page: `src/app/dashboard/page.tsx:64`
- Column definitions: `src/db/schema.ts:392-397`
- Kuma feature consumers: `src/lib/uptime-kuma.ts`, `src/lib/uptime-monitoring.ts`
- Migration workflow: `drizzle.config.ts`, `package.json` (`db:push` / `db:generate` / `db:migrate`)
