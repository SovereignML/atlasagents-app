#!/usr/bin/env bash
# Deploy entrypoint: apply pending Drizzle migrations, THEN start the
# Next.js standalone server. Wired into both deploy paths (deploy/pm2.config.cjs
# and deploy/redesigned-giggle.service) so the app can never serve traffic
# against an un-migrated database.
#
# Why this exists: a deploy that shipped code referencing new columns
# (Subscription.nextCreditGrantAt, Instance.expiresAt) without applying the
# matching migrations took down the Overview and Billing pages — every Drizzle
# relational query selects an explicit column list, so a missing column throws
# `column ... does not exist`. Running migrate on start closes that gap.
#
# `drizzle-kit migrate` is idempotent: it consults the __drizzle_migrations
# journal and no-ops when the schema is already current, so running it on every
# process start (including crash restarts) is safe and cheap.
set -euo pipefail

cd "$(dirname "$0")/.."

DRIZZLE="node_modules/drizzle-kit/bin.cjs"
if [ ! -f "$DRIZZLE" ]; then
  echo "[entrypoint] drizzle-kit not found at $DRIZZLE — run 'npm ci' first." >&2
  exit 1
fi

SERVER=".next/standalone/server.js"
if [ ! -f "$SERVER" ]; then
  echo "[entrypoint] $SERVER not found — run 'npm run build' first." >&2
  exit 1
fi

# Load DATABASE_URL etc. from the repo-root .env when present (the pm2 path
# loads exactly this one file). Under systemd the vars already come from the
# unit's EnvironmentFile, so there's no .env to load and we skip --env-file.
ENV_FLAG=()
if [ -f .env ]; then
  ENV_FLAG=(--env-file=.env)
fi

echo "[entrypoint] Applying database migrations…"
node "${ENV_FLAG[@]}" "$DRIZZLE" migrate
echo "[entrypoint] Schema is up to date. Starting server…"

# exec replaces this shell with node under the SAME pid, so pm2/systemd keep
# managing the server process (signals, restarts, memory limits) as before.
exec node "${ENV_FLAG[@]}" "$SERVER"
