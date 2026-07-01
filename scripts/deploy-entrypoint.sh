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
ENV_FLAG=()
if [ -f .env ]; then
  ENV_FLAG=(--env-file=.env)
fi

DRIZZLE="node_modules/drizzle-kit/bin.cjs"
if [ -f "$DRIZZLE" ]; then
  echo "[entrypoint] Syncing database schema (drizzle-kit push)…"
  if node "${ENV_FLAG[@]}" "$DRIZZLE" push --force; then
    echo "[entrypoint] Schema is up to date."
  else
    echo "[entrypoint] WARNING: schema sync failed — starting the server anyway" \
         "with the existing schema. Fix the database and restart." >&2
  fi
else
  echo "[entrypoint] WARNING: drizzle-kit not found at $DRIZZLE — skipping schema" \
       "sync. Run 'npm ci' if the schema is out of date." >&2
fi

echo "[entrypoint] Starting server…"
# exec replaces this shell with node under the SAME pid, so pm2/systemd keep
# managing the server process (signals, restarts, memory limits) as before.
exec node "${ENV_FLAG[@]}" "$SERVER"
