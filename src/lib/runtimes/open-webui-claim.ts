/**
 * Prewarmed Open WebUI: start the chat UI at bake time, then hand it to the
 * customer at claim time without restarting it.
 *
 * Why: Open WebUI's first boot is slow (SQLite schema, migrations, importing a
 * very large Python tree), and the claim used to throw that warm-up away. The
 * install+start phase stopped and restarted every service, and the sidecar unit
 * `Requires=` the gateway, so restarting the gateway restarted it too. A claim
 * therefore cold-started Open WebUI while the health check counted down. When
 * it lost that race the deploy was soft-committed "running" with no admin
 * account, signup open, and the bake-time placeholder token still wired in.
 *
 * Now, at bake:
 *  - the sidecar gets a random per-VM `WEBUI_SECRET_KEY` (it used to be a fixed
 *    placeholder, which was only safe because the claim always restarted it);
 *  - it is started and waited on until it answers, then a marker file records
 *    that this box holds a ready, account-less Open WebUI.
 *
 * At claim, when that marker is present and the sidecar is healthy:
 *  - the env file is rewritten with the real values but keeps the bake secret;
 *  - the sidecar is not restarted;
 *  - the customer's admin account is created through Open WebUI's own signup
 *    API, and the running process is pointed at the real gateway token,
 *    default model and public URL through its admin API. Signup is then locked.
 *
 * Open WebUI runs with `ENABLE_PERSISTENT_CONFIG=false`, so admin-API writes
 * land in the live process only. The env file, which the claim writes too,
 * carries the same values into every later restart.
 *
 * Kept out of provisioner.ts because that module pulls in the database, and the
 * tests here are unit-only.
 */

import { OPEN_WEBUI_INSTALL_DIR, OPEN_WEBUI_VENV, bashSingleQuote } from "./open-webui"

/**
 * Written at bake once a freshly started Open WebUI answers, with a random
 * secret in its env and no accounts. Its presence is what lets a claim reuse
 * the running process. Boxes baked before this change lack it and take the
 * old restart-then-seed path.
 */
export const OPEN_WEBUI_PREWARM_MARKER = `${OPEN_WEBUI_INSTALL_DIR}/.atlas-prewarmed`

/** Printed by the install+start phase when it kept the prewarmed sidecar running. */
export const SIDECAR_PREWARMED = "SIDECAR_PREWARMED"

/** How long the bake waits for a cold Open WebUI to answer. Bake is off the critical path. */
const BAKE_SIDECAR_READY_TIMEOUT_S = 300

/**
 * Replace (or add) `KEY=value` in an env file without `sed` escaping hazards,
 * keeping the file's mode and owner (`cat >` rather than `mv`). Shell snippet;
 * expects `set -e`-safe callers. Values here are hex secrets and booleans.
 */
function envReplaceLine(envPathExpr: string, key: string, valueExpr: string): string {
  return `{ grep -v '^${key}=' ${envPathExpr} || true; echo "${key}=${valueExpr}"; } > ${envPathExpr}.atlas-tmp
cat ${envPathExpr}.atlas-tmp > ${envPathExpr}
rm -f ${envPathExpr}.atlas-tmp`
}

/**
 * Bake: write the placeholder env, give it a random per-VM session secret,
 * start the sidecar and (optionally) wait until it answers, then drop the
 * prewarm marker. Best-effort throughout, like the rest of bake-finalize: a
 * miss here only means the claim takes the slower restart path.
 *
 * `waitForReady` is off for BYOS prebake, whose deploy always takes the normal
 * restart path and must not hold the connect step for minutes.
 */
export function buildSidecarBakeSteps(opts: {
  envB64: string
  envPath: string
  unitB64: string
  serviceName: string
  port: number
  healthPath: string
  waitForReady: boolean
}): string {
  const env = bashSingleQuote(opts.envPath)
  const svc = bashSingleQuote(opts.serviceName)
  const marker = bashSingleQuote(OPEN_WEBUI_PREWARM_MARKER)
  const health = bashSingleQuote(`http://127.0.0.1:${opts.port}${opts.healthPath}`)
  const wait = opts.waitForReady
    ? `
echo "=== bake: open-webui wait_ready ==="
for _ in $(seq 1 ${Math.ceil(BAKE_SIDECAR_READY_TIMEOUT_S / 2)}); do
  if curl -sf -o /dev/null -m 5 ${health}; then
    install -m 0644 /dev/null ${marker}
    echo "=== bake: open-webui prewarmed ==="
    break
  fi
  sleep 2
done
[ -f ${marker} ] || echo "open-webui did not answer within ${BAKE_SIDECAR_READY_TIMEOUT_S}s; the claim will restart it" >&2`
    : ""

  return `
echo "=== bake: open-webui warmup ==="
rm -f ${marker}
mkdir -p "$(dirname ${env})"
echo ${bashSingleQuote(opts.envB64)} | base64 -d > ${env}
# Per-VM session-signing secret. A prewarmed sidecar keeps running through the
# claim, so this is the secret the customer's sessions are signed with.
BAKE_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n')
${envReplaceLine(env, "WEBUI_SECRET_KEY", "${BAKE_SECRET}")}
unset BAKE_SECRET
chmod 600 ${env}
echo ${bashSingleQuote(opts.unitB64)} | base64 -d > "/etc/systemd/system/${opts.serviceName}.service"
systemctl daemon-reload
systemctl enable ${svc} || true
systemctl restart ${svc} || true${wait}
`
}

/**
 * Claim, Phase A: after the sidecar env has been rewritten with the real
 * values, put the bake secret back. Only when the box is prewarmed — otherwise
 * the sidecar restarts anyway and the freshly generated secret is correct.
 * Runs under `set -euo pipefail`. The caller captures `PREWARM_SECRET` from
 * the old file before overwriting it (see {@link buildCaptureBakeSecret}).
 */
export function buildRestoreBakeSecret(envPath: string): string {
  const env = bashSingleQuote(envPath)
  return `if [ -n "\${PREWARM_SECRET:-}" ]; then
  echo "=== provision: keep_prewarmed_webui_secret ==="
  ${envReplaceLine(env, "WEBUI_SECRET_KEY", "${PREWARM_SECRET}").replace(/\n/g, "\n  ")}
fi
unset PREWARM_SECRET`
}

/** Claim, Phase A: read the bake secret before the env file is replaced. */
export function buildCaptureBakeSecret(envPath: string): string {
  const env = bashSingleQuote(envPath)
  const marker = bashSingleQuote(OPEN_WEBUI_PREWARM_MARKER)
  return `PREWARM_SECRET=""
if [ -f ${marker} ] && [ -f ${env} ]; then
  PREWARM_SECRET=$(grep '^WEBUI_SECRET_KEY=' ${env} | tail -n 1 | cut -d= -f2- || true)
fi`
}

/**
 * Claim, install+start phase: keep a prewarmed, healthy sidecar running;
 * otherwise fall through to the normal start-and-health routine. The unit file
 * has already been rewritten (now `Wants=` the gateway) and reloaded by the
 * time this runs, so the gateway restart before it did not touch the sidecar.
 */
export function buildReusePrewarmedSidecar(opts: {
  serviceName: string
  port: number
  healthPath: string
  /** The shell command that starts the service the normal way. */
  startCommand: string
}): string {
  const marker = bashSingleQuote(OPEN_WEBUI_PREWARM_MARKER)
  const svc = bashSingleQuote(opts.serviceName)
  const health = bashSingleQuote(`http://127.0.0.1:${opts.port}${opts.healthPath}`)
  return `if [ -f ${marker} ] && systemctl is-active --quiet ${svc} && curl -sf -o /dev/null -m 5 ${health}; then
  echo "=== provision: ${SIDECAR_PREWARMED} (${opts.serviceName}) ==="
else
  ${opts.startCommand}
fi`
}

/**
 * The program that hands a running, account-less Open WebUI to the customer.
 * Plain stdlib Python, run by the sidecar's own venv interpreter. Reads every
 * value except the credentials from the env file Phase A just wrote, so the
 * live process and the next restart can never disagree. Prints no secrets.
 */
const CLAIM_PY = String.raw`
import json, os, sys, time, urllib.error, urllib.request

env_path, base = sys.argv[1], sys.argv[2]


def load_env(path):
    out = {}
    with open(path) as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
                value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            out[key] = value
    return out


def call(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        try:
            raw = err.read()
            return err.code, (json.loads(raw) if raw else None)
        except Exception:
            return err.code, None
    except Exception as err:
        return 0, str(err)


def die(msg):
    print("claim failed: " + msg, file=sys.stderr)
    sys.exit(1)


env = load_env(env_path)
email = os.environ["OWUI_ADMIN_EMAIL"]
password = os.environ["OWUI_ADMIN_PASSWORD"]

for _ in range(15):
    if call("GET", "/health")[0] == 200:
        break
    time.sleep(1)
else:
    die("open-webui is not answering")

code, res = call("POST", "/api/v1/auths/signup", {"name": "Admin", "email": email, "password": password})
if code in (400, 403):
    # A retried claim: the account already exists. Sign in with the same credentials.
    print("signup refused (HTTP %s); signing in" % code)
    code, res = call("POST", "/api/v1/auths/signin", {"email": email, "password": password})
if code != 200 or not isinstance(res, dict) or not res.get("token"):
    die("could not create or sign in to the admin account (HTTP %s)" % code)
if res.get("role") not in (None, "admin"):
    die("the account is %r, not admin" % res.get("role"))
token = res["token"]
print("=== claim: admin account ready ===")

base_url = env.get("OPENAI_API_BASE_URL")
api_key = env.get("OPENAI_API_KEY")
if not base_url or not api_key:
    die("the env file has no OPENAI_API_BASE_URL / OPENAI_API_KEY")
code, cur = call("GET", "/openai/config", token=token)
if code != 200 or not isinstance(cur, dict):
    die("could not read the model connection (HTTP %s)" % code)
code, _ = call("POST", "/openai/config/update", {
    "ENABLE_OPENAI_API": True,
    "OPENAI_API_BASE_URLS": [base_url],
    "OPENAI_API_KEYS": [api_key],
    "OPENAI_API_CONFIGS": cur.get("OPENAI_API_CONFIGS") or {},
}, token)
if code != 200:
    die("could not update the model connection (HTTP %s)" % code)
print("=== claim: model connection set ===")

default_models = env.get("DEFAULT_MODELS", "").strip()
if default_models:
    code, cur = call("GET", "/api/v1/configs/models", token=token)
    if code != 200 or not isinstance(cur, dict):
        die("could not read the model defaults (HTTP %s)" % code)
    for key in ("DEFAULT_PINNED_MODELS", "MODEL_ORDER_LIST"):
        cur.setdefault(key, None)
    cur["DEFAULT_MODELS"] = default_models
    code, _ = call("POST", "/api/v1/configs/models", cur, token)
    if code != 200:
        die("could not set the default model (HTTP %s)" % code)
    print("=== claim: default model set ===")

# Signup already locks itself once the first account exists. Setting it here
# as well covers versions that do not, and carries the public URL.
code, cur = call("GET", "/api/v1/auths/admin/config", token=token)
if code == 200 and isinstance(cur, dict):
    cur["ENABLE_SIGNUP"] = False
    if env.get("WEBUI_URL"):
        cur["WEBUI_URL"] = env["WEBUI_URL"]
    code, _ = call("POST", "/api/v1/auths/admin/config", cur, token)
if code != 200:
    print("warning: admin settings not updated (HTTP %s)" % code, file=sys.stderr)

code, cfg = call("GET", "/api/config")
features = cfg.get("features") if isinstance(cfg, dict) else None
if code != 200 or not isinstance(features, dict) or features.get("enable_signup") is not False:
    die("public signup is still open")
print("=== claim: signup locked ===")
`

/**
 * Claim, after the gateway is healthy: create the customer's admin account on
 * the prewarmed sidecar and point it at the real gateway, without a restart.
 * Then record `ENABLE_SIGNUP=false` in the env file for later restarts.
 *
 * A non-zero exit means the live hand-off did not complete. The caller falls
 * back to the restart-based seed, which still works because the env file
 * already holds the real values.
 */
export function buildClaimPrewarmedSidecarScript(opts: {
  port: number
  envPath: string
  adminEmail: string
  adminPassword: string
}): string {
  const env = bashSingleQuote(opts.envPath)
  return `#!/bin/bash
set -uo pipefail
echo "=== claim: open-webui ==="
PY=${bashSingleQuote(`${OPEN_WEBUI_VENV}/bin/python`)}
[ -x "\${PY}" ] || PY=python3
export OWUI_ADMIN_EMAIL=${bashSingleQuote(opts.adminEmail)}
export OWUI_ADMIN_PASSWORD=${bashSingleQuote(opts.adminPassword)}
"\${PY}" -I - ${env} ${bashSingleQuote(`http://127.0.0.1:${opts.port}`)} <<'ATLAS_CLAIM_PY'
${CLAIM_PY}
ATLAS_CLAIM_PY
RC=$?
unset OWUI_ADMIN_EMAIL OWUI_ADMIN_PASSWORD
[ "\${RC}" = "0" ] || exit "\${RC}"

${envReplaceLine(env, "ENABLE_SIGNUP", "false")}
# The box now has an account, so it is no longer "prewarmed and account-less".
rm -f ${bashSingleQuote(OPEN_WEBUI_PREWARM_MARKER)}
echo "=== claim: done ==="
`
}
