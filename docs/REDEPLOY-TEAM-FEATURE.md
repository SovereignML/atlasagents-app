# Redeploy notes — team-feature schema (migration 0008) (2026-05-30)

A fix for the `/dashboard` runtime error. Read this before the next production deploy.

---

## What broke

`src/app/dashboard/page.tsx` runs `db.query.instances.findMany(...)`, which SELECTs **every**
column in the `instances` Drizzle model and (via `whereUserInstancesVisible` in
`src/lib/instance-queries.ts`) references `instances.teamId`, the `Team` table, and the
`InstanceAccess` table. These were added to `src/db/schema.ts` for the team feature but **not to
the database**, so Postgres rejected the query:

```
column instances.teamId does not exist
```

Missing in the DB (migration `0008_sweet_hannibal_king`):

- table `InstanceAccess` (per-agent ACL)
- `teamId` column on `Instance`, `SshKey`, `DriveConnection`, `CloudflareConnection`, `BackupRecord`
- the `teamId` indexes; drop of the old `*_userId_key` unique indexes on the provider tables

## Why `db:migrate` could not be used

`drizzle.__drizzle_migrations` has **0 rows** — these databases were built entirely with
`db:push`, never with tracked migrations. So `db:migrate` replays from `0000`, hits
`CREATE TABLE` on already-existing tables, and aborts. Same situation documented in
`docs/REDEPLOY-KUMA-COLUMNS.md`. The schema is push-managed.

`db:push` is also **not** safe for `0008`: it adds `teamId` as `NOT NULL`, which is only valid
after a personal `Team` is seeded per user and existing rows are backfilled. Push would add a
NOT-NULL column with no default to populated tables and fail, and would skip the backfill
entirely.

## What was done (local dev DB only)

Applied the reviewed `0008` SQL — made idempotent — via the `pg` client. The script
(`drizzle/fixes/0008-team-feature-apply.sql`) is additive and re-runnable: `IF [NOT] EXISTS`
guards on tables/columns/indexes, `DO`-block guards on constraints, `WHERE NOT EXISTS` on the
team/membership seeding, and `WHERE "teamId" IS NULL` on the backfills. **Production was not
touched.** Verified: `Instance.teamId` present, `InstanceAccess` exists, 0 rows with NULL
`teamId`, and the dashboard visibility query succeeds.

Local state for context: `0007` (kuma columns) and `0009` (`DeletionRequest`) were already
applied; `0008` was the only gap.

---

## ✅ TODO on redeployment

- [ ] **Apply migration 0008 to the production / remote DB.** Run the idempotent script against
      the prod `DATABASE_URL` (additive, non-destructive, safe to run more than once):

      ```bash
      node --env-file=.env.production -e "const fs=require('fs');const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(fs.readFileSync('drizzle/fixes/0008-team-feature-apply.sql','utf8'));await c.end();console.log('0008 applied')})()"
      ```

      or `psql "$PROD_DATABASE_URL" -f drizzle/fixes/0008-team-feature-apply.sql`.

      The script seeds a personal `Team` (+ owner `Membership`) for any prod user lacking one,
      then backfills `teamId` from that team before enforcing `NOT NULL`. Prod must already have
      `0007`/`0009` applied (same as local); `Team`/`Membership` predate this change.

- [ ] **Verify after applying:** reload `/dashboard` on prod — it should render without the
      "Failed query" error. Optional: confirm `Instance.teamId` exists and no rows are NULL.

- [ ] **(Bigger, separate task) Adopt tracked migrations.** Migrations are still not tracked on
      any of these DBs (`__drizzle_migrations` empty). Baseline the journal once to use
      reviewable `db:migrate` going forward. Out of scope for this fix — see the same TODO in
      `docs/REDEPLOY-KUMA-COLUMNS.md`.

---

## Reference

- Failing query / page: `src/app/dashboard/page.tsx:64`
- Visibility predicate: `src/lib/instance-queries.ts`
- Reviewed migration: `drizzle/migrations/0008_sweet_hannibal_king.sql`
- Idempotent apply script: `drizzle/fixes/0008-team-feature-apply.sql`
- Prior, same-class fix: `docs/REDEPLOY-KUMA-COLUMNS.md`
