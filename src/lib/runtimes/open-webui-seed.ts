/**
 * The restart-based Open WebUI admin seed, used on every deploy that can't
 * hand over a prewarmed sidecar (see open-webui-claim.ts for that path).
 *
 * Kept out of provisioner.ts, which pulls in the database, so the script's
 * fail-closed branch can be unit-tested.
 */
import { bashSingleQuote } from "./open-webui"

/**
 * Seed the sidecar's first (admin) account, then lock signup. Open WebUI has no
 * auto-admin env: the first account created via the signup endpoint becomes
 * admin. We retry while the container's HTTP server warms up; a 400/403 means
 * the account already exists (idempotent on reprovision). On success we flip
 * ENABLE_SIGNUP=false in the env file and restart so the public URL isn't an
 * open registration page.
 *
 * Fails closed: when the admin can't be created, the sidecar is stopped and
 * disabled before exiting non-zero. Otherwise signup would stay open and the
 * first visitor to the chat URL would become admin, which on Hermes means
 * running commands on the box and spending the customer's credits. A
 * reprovision starts the unit again and retries the seed.
 */
export function buildSeedSidecarAdminScript(opts: {
  port: number
  signupPath: string
  envPath: string
  serviceName: string
  adminEmail: string
  adminPassword: string
}): string {
  const payload = JSON.stringify({
    name: "Admin",
    email: opts.adminEmail,
    password: opts.adminPassword,
  })
  return `#!/bin/bash
set -uo pipefail
SIGNUP_URL="http://127.0.0.1:${opts.port}${opts.signupPath}"
ENV_PATH=${bashSingleQuote(opts.envPath)}
SERVICE=${bashSingleQuote(opts.serviceName)}
PAYLOAD=${bashSingleQuote(payload)}

echo "=== seed: open-webui admin ==="
OK=0
CODE=""
for _ in \$(seq 1 30); do
  CODE=\$(curl -s -o /tmp/owui_signup.out -w '%{http_code}' -m 8 -X POST "\${SIGNUP_URL}" -H 'Content-Type: application/json' -d "\${PAYLOAD}" || echo "000")
  if [ "\${CODE}" = "200" ] || [ "\${CODE}" = "201" ]; then
    OK=1
    break
  fi
  if [ "\${CODE}" = "400" ] || [ "\${CODE}" = "403" ]; then
    echo "admin signup returned \${CODE} — treating as already-seeded"
    OK=1
    break
  fi
  sleep 2
done

if [ "\${OK}" != "1" ]; then
  echo "open-webui admin signup failed (last code \${CODE})" >&2
  cat /tmp/owui_signup.out 2>/dev/null || true
  echo "=== seed: fail closed (stopping \${SERVICE}) ===" >&2
  systemctl disable --now "\${SERVICE}" >/dev/null 2>&1 || systemctl stop "\${SERVICE}" || true
  exit 1
fi

echo "=== seed: lock signup ==="
if grep -q '^ENABLE_SIGNUP=' "\${ENV_PATH}"; then
  sed -i 's/^ENABLE_SIGNUP=.*/ENABLE_SIGNUP=false/' "\${ENV_PATH}"
else
  echo 'ENABLE_SIGNUP=false' >> "\${ENV_PATH}"
fi
systemctl restart "\${SERVICE}"
echo "=== seed: done ==="
`
}
