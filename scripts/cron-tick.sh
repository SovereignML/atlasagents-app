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
# Nightly jobs (backups, prunes) are NOT included here — wire those as separate
# crontab lines. Jobs that need to be periodic but not every minute are gated on
# the current minute via tick_every below, so this stays a single crontab entry.
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

# endpoint_path  TOKEN_ENV_NAME  [timeout_seconds]
#
# The timeout is per endpoint. It used to be a flat 30s for everything, which
# was shorter than /api/admin/reconcile's own documented requirement, so that
# request's client was aborted on every single run. Aborting the client does
# NOT stop the handler — the work continued server-side, unobserved, with the
# exit code always reading as a failure.
DEFAULT_TIMEOUT=30
tick() {
  local path="$1" token_name="$2" timeout="${3:-$DEFAULT_TIMEOUT}"
  local token; token="$(get_env "$token_name")"
  if [[ -z "$token" ]]; then
    echo "[cron-tick] skip $path — $token_name unset"
    return 0
  fi
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${token}" \
    --max-time "${timeout}" "${BASE}${path}" || echo "000")"
  echo "[cron-tick] $(date -u +%FT%TZ) POST $path -> $code"
}

# Run $2... only on minutes divisible by $1. `10#` forces base-10 so a leading
# zero (08, 09) isn't parsed as octal.
MINUTE=$((10#$(date -u +%M)))
HOUR=$((10#$(date -u +%H)))
tick_every() {
  local every="$1"; shift
  if (( MINUTE % every == 0 )); then
    tick "$@"
  fi
}

# Run $1... only at the given UTC hour, on the hour. Used for the twice-daily
# housekeeping pass. Assumes this script itself runs every minute.
tick_at_hour() {
  local hour="$1"; shift
  if (( HOUR == hour && MINUTE == 0 )); then
    tick "$@"
  fi
}

# Frequent endpoints (run every minute). Add more lines as needed.
tick /api/internal/uptime-sync  UPTIME_SYNC_CRON_TOKEN
tick /api/internal/metrics-collect  METRICS_COLLECT_CRON_TOKEN
tick /api/internal/alerts-eval  ALERTS_EVAL_CRON_TOKEN
tick /api/billing/usage-sync    USAGE_SYNC_CRON_TOKEN
tick /api/internal/demo-reap    DEMO_REAP_CRON_TOKEN

# Periodic, not per-minute.
#
# /api/admin/reconcile is one endpoint doing two very different jobs, and its
# cadence was set by the most urgent of them:
#
#   money + routing  — the orphan VM sweep (VMs bill hourly; ORPHAN_GRACE_MS is
#                      15 min), retried deletes for `deleting`/`failed` rows,
#                      the provider health probe that gates the VPS router's
#                      "down" rejection, and the budget/burn sync that gates
#                      its hard-limit rejection. This endpoint is the ONLY
#                      caller of the last two, so its interval is exactly how
#                      stale the router's inputs can be.
#   housekeeping     — orphan OpenRouter key revocation, reconciledAt stamping,
#                      credit-drift detection. None of it is time-critical.
#
# Running the whole thing every 10 minutes over-ran the housekeeping; running
# the whole thing twice a day would have widened the spend-limit and
# orphaned-VM windows to ~12 hours. So it stays frequent, and the interval is
# now stated as what it actually buys: a bound on router staleness and on how
# long an untracked VM can bill.
#
# Stuck-deploy recovery is NO LONGER a reason for this cadence: a dead deploy
# holds no advisory lock, so the retry endpoint lets the user restart it within
# ~2 minutes on their own (see provision-liveness.ts). That argument justified
# the original nightly → 10-minute change and has since expired.
#
# Overlapping runs are safe: runReconcilerLocked() takes a fleet-wide advisory
# lock and an overlapping tick is a no-op.
tick_every 15 "/api/admin/reconcile?scope=fast"  RECONCILE_CRON_TOKEN 120

# The expensive housekeeping half (list + spend-cap-heal every OpenRouter key,
# credit-drift audit) twice a day. Nothing here gates a live decision, and
# running it 96×/day was the bulk of this endpoint's cost.
tick_at_hour 3  /api/admin/reconcile  RECONCILE_CRON_TOKEN 300
tick_at_hour 15 /api/admin/reconcile  RECONCILE_CRON_TOKEN 300
