#!/usr/bin/env bash
#
# cron-tick.sh — drive the app's frequent internal cron endpoints from a single
# system-cron entry. Each endpoint authenticates with its own bearer token (see
# docs/DEPLOYMENT.md "Scheduled jobs"); this script just curls them on the host.
#
# Hits the app on localhost (where pm2 serves it), so no public URL / TLS needed.
#
# Install (run every minute; the endpoints are individually throttled/cheap):
#
#   crontab -e
#   * * * * * /path/to/repo/scripts/cron-tick.sh >> /var/log/redesigned-giggle/cron.log 2>&1
#
# Daily/nightly jobs (backups, prunes, reconcile) are NOT included here — wire
# those as separate, less-frequent crontab lines.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[cron-tick] .env not found at $ENV_FILE" >&2
  exit 1
fi

# Pull only the values we need (avoids `set -a` sourcing the whole file).
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/[[:space:]]+#.*$//'; }

PORT="$(get_env PORT)"; PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"

# endpoint_path  TOKEN_ENV_NAME
tick() {
  local path="$1" token_name="$2"
  local token; token="$(get_env "$token_name")"
  if [[ -z "$token" ]]; then
    echo "[cron-tick] skip $path — $token_name unset"
    return 0
  fi
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${token}" \
    --max-time 30 "${BASE}${path}" || echo "000")"
  echo "[cron-tick] $(date -u +%FT%TZ) POST $path -> $code"
}

# Frequent endpoints (run every minute). Add more lines as needed.
tick /api/internal/uptime-sync  UPTIME_SYNC_CRON_TOKEN
tick /api/internal/alerts-eval  ALERTS_EVAL_CRON_TOKEN
tick /api/billing/usage-sync    USAGE_SYNC_CRON_TOKEN
