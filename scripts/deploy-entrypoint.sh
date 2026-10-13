#!/usr/bin/env bash
# Deploy entrypoint: sync the database schema, THEN start the Next.js
# standalone server. Wired into both deploy paths (deploy/pm2.config.cjs and
# deploy/redesigned-giggle.service) so a deploy can't serve traffic against a
# schema that's missing columns the code selects.
#
# Why this exists: a deploy that shipped code referencing new columns
# (Subscription.nextCreditGrantAt, Instance.expiresAt) without syncing the DB
# took down the Overview and Billing pages — every Drizzle relational query
# selects an explicit column list, so a missing column throws
# `column ... does not exist`.
#
# We use `drizzle-kit push --force`, NOT `migrate`: this project has always
# managed its schema with push (see scripts/bootstrap-pg.sh and docs), so the
# __drizzle_migrations journal that `migrate` relies on isn't populated —
# `migrate` would try to replay every migration and fail on already-existing
# columns. push diffs the live schema against src/db/schema.ts and is
# idempotent (a no-op when already in sync).
#
# Before pushing, scripts/schema-guard.ts checks that the push would drop no
# table or column the schema doesn't define (push --force drops them without
# asking); if it would, the push is skipped. See that script.
#
# The schema sync is deliberately NON-FATAL: if it fails we log loudly and
# start the server anyway. A schema-tool problem should degrade to "some pages
# error" (the pre-entrypoint state), never a full crash-loop that takes the
# whole site down.
set -uo pipefail

cd "$(dirname "$0")/.."

SERVER=".next/standalone/server.js"
if [ ! -f "$SERVER" ]; then
  echo "[entrypoint] FATAL: $SERVER not found — run 'npm run build' first." >&2
  exit 1
fi

# Load DATABASE_URL etc. from the repo-root .env when present (the pm2 path
# loads exactly this one file). Under systemd the vars already come from the
# unit's EnvironmentFile, so there's no .env to load and we skip --env-file.
# (Expanded as ${ENV_FLAG[@]+...} so an empty array survives `set -u` on bash < 4.4.)
ENV_FLAG=()
if [ -f .env ]; then
  ENV_FLAG=(--env-file=.env)
fi

DRIZZLE="node_modules/drizzle-kit/bin.cjs"
if [ -f "$DRIZZLE" ]; then
  # push --force drops any table or column the schema doesn't define, without
  # asking. Check first (scripts/schema-guard.ts); skip the push rather than
  # lose data. SCHEMA_GUARD_ALLOW_DROP accepts a drop on purpose.
  echo "[entrypoint] Checking what a schema sync would drop…"
  node ${ENV_FLAG[@]+"${ENV_FLAG[@]}"} --import tsx scripts/schema-guard.ts
  GUARD=$?
  if [ "$GUARD" -eq 0 ]; then
    echo "[entrypoint] Syncing database schema (drizzle-kit push)…"
    if node ${ENV_FLAG[@]+"${ENV_FLAG[@]}"} "$DRIZZLE" push --force; then
      echo "[entrypoint] Schema is up to date."
    else
      echo "[entrypoint] WARNING: schema sync failed — starting the server anyway" \
           "with the existing schema. Fix the database and restart." >&2
    fi
  elif [ "$GUARD" -eq 3 ]; then
    echo "[entrypoint] WARNING: schema sync SKIPPED — it would drop the data listed" \
         "above. Starting on the existing schema; new columns are NOT applied." >&2
  else
    echo "[entrypoint] WARNING: schema guard failed (exit $GUARD), so the schema sync" \
         "was skipped. Starting on the existing schema." >&2
  fi
else
  echo "[entrypoint] WARNING: drizzle-kit not found at $DRIZZLE — skipping schema" \
       "sync. Run 'npm ci' if the schema is out of date." >&2
fi

echo "[entrypoint] Starting server…"
# exec replaces this shell with node under the SAME pid, so pm2/systemd keep
# managing the server process (signals, restarts, memory limits) as before.
exec node ${ENV_FLAG[@]+"${ENV_FLAG[@]}"} "$SERVER"
