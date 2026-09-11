/**
 * Generator for the in-place env-file patch script used on provisioned boxes.
 *
 * Pure string building, deliberately in its own module: `provisioner.ts` pulls in
 * the DB singleton, and tests here are unit-only (`vitest.config.ts`). This script
 * rewrites credentials on a live VPS, so it needs a test that actually runs it.
 */

function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Printed on stdout so the caller can decide whether a service restart is
 * warranted. A restart drops in-flight chat streams, so it must not happen on a
 * no-op pass.
 */
export const ENV_KEY_CHANGED = "ENV_KEY_CHANGED"
export const ENV_KEY_UNCHANGED = "ENV_KEY_UNCHANGED"

export type EnvUpsertEntry = { key: string; value: string }

/** Keys are interpolated into a `grep` pattern, so keep them to the dotenv shape. */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Upsert one or more keys in an on-box env file, in place, reporting whether
 * anything actually changed.
 *
 * Why patch instead of re-rendering the file from the template: the on-box copy
 * has been mutated since it was written. The admin seed flips `ENABLE_SIGNUP` to
 * false once the first account exists, and the file carries `WEBUI_SECRET_KEY` —
 * a session-signing secret generated per provision and never persisted
 * platform-side. A wholesale re-render would reopen public signup on a customer's
 * chat UI and log out every existing chat user.
 *
 * Filter-and-append rather than `sed -i`. `sed -i` takes a mandatory backup suffix
 * on BSD and none on GNU, so the same script cannot run on both; more importantly
 * `sed`'s replacement side gives `/`, `&` and `\` meaning, and these values are
 * model slugs and URLs full of slashes. Rewriting through `grep -v` keeps every
 * value a literal and removes that escaping hazard entirely.
 *
 * The rewrite goes through a temp file but lands with `cat > "$ENV_PATH"`, not
 * `mv`: the env file is chmod 600 and owned by the runtime's system user, and a
 * `mv` would replace it with the temp file's mode and ownership.
 *
 * Prints `ENV_KEY_UNCHANGED` only when EVERY key already matches, `ENV_KEY_CHANGED`
 * when at least one was written. Each write is re-read before success is claimed —
 * the script does not run under `set -e`, so a failure would otherwise be masked
 * by the trailing echo and reported as success.
 */
export function buildEnvKeyUpsertScript(opts: {
  envPath: string
  entries: EnvUpsertEntry[]
}): string {
  if (opts.entries.length === 0) {
    throw new Error("buildEnvKeyUpsertScript: at least one entry is required")
  }
  for (const { key } of opts.entries) {
    if (!ENV_KEY_RE.test(key)) {
      throw new Error(`buildEnvKeyUpsertScript: unsafe env key ${JSON.stringify(key)}`)
    }
  }

  const calls = opts.entries
    .map(({ key, value }) =>
      `upsert ${bashSingleQuote(key)} ${bashSingleQuote(`${key}=${value}`)} || exit 1`,
    )
    .join("\n")

  return `#!/bin/bash
set -uo pipefail
ENV_PATH=${bashSingleQuote(opts.envPath)}
if [ ! -f "\${ENV_PATH}" ]; then
  echo "env file \${ENV_PATH} not found" >&2
  exit 1
fi
CHANGED=0
upsert() {
  local key="\$1" line="\$2" tmp
  # -x -F: whole line, literal. Already correct → nothing to do, no restart.
  if grep -qxF "\$line" "\${ENV_PATH}"; then
    return 0
  fi
  tmp=\$(mktemp) || return 1
  # Drops every existing definition of the key, including duplicates. Exits 1
  # when it filters the file empty, which is a valid outcome here, not an error.
  grep -v "^\${key}=" "\${ENV_PATH}" > "\$tmp"
  printf '%s\\n' "\$line" >> "\$tmp" || { rm -f "\$tmp"; return 1; }
  # cat, not mv — preserves the file's 0600 mode and its owner.
  cat "\$tmp" > "\${ENV_PATH}" || { rm -f "\$tmp"; return 1; }
  rm -f "\$tmp"
  if ! grep -qxF "\$line" "\${ENV_PATH}"; then
    echo "failed to set \${key} in \${ENV_PATH}" >&2
    return 1
  fi
  CHANGED=1
}
${calls}
if [ "\${CHANGED}" = "1" ]; then
  echo "${ENV_KEY_CHANGED}"
else
  echo "${ENV_KEY_UNCHANGED}"
fi
`
}
