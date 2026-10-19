/* --- Shared Python install helpers ----------------------------------------- */
/**
 * Bash for the Python installs on an agent box: Hermes itself (hermes-agent)
 * and the chat UI (AgentWebUI Lite). Both live in their own venvs, installed
 * with `uv` when it can be had and pip otherwise.
 */

/** Python floor shared by hermes-agent and AgentWebUI Lite (`requires_python >=3.11`). */
export const PYTHON_MIN = "3.11"

export function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * `verify_python` for a given exclusive upper bound. Fails in seconds, with a
 * message naming the actual version, rather than letting a doomed install run.
 */
export function buildVerifyPythonStep(maxExclusive: string): string {
  const [maj, min] = maxExclusive.split(".")
  return `step "verify_python"
if ! python3 -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] < (${maj}, ${min}) else 1)'; then
  PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  echo "Requires Python ${PYTHON_MIN}+ and older than ${maxExclusive}, found $PY_VER" >&2
  exit 1
fi`
}

/**
 * Shared shell prelude for the Python installs: `uv` when it can be had, pip
 * otherwise. Defines `venv_create` and `py_install`.
 *
 * `uv` resolves and installs several times faster than pip, and it is a single
 * static binary. It is strictly an accelerator: every function falls back to
 * pip when `uv` is missing or its install fails, because astral.sh would
 * otherwise become a hard dependency on the critical path of every provision.
 *
 * `python3 -m venv --upgrade-deps` in the fallback also removes the separate
 * `pip install --upgrade pip setuptools wheel` round-trip per venv.
 */
export function buildPyInstallPrelude(): string {
  return `
step "install_uv"
# Best-effort. UV_INSTALL_DIR puts it somewhere on root's PATH; a failure here
# is not fatal, it just means the pip fallback below does the work.
export UV_INSTALL_DIR=/usr/local/bin
command -v uv >/dev/null 2>&1 || curl -fsSL --retry 3 --retry-delay 2 https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true
command -v uv >/dev/null 2>&1 && uv --version || echo "uv unavailable — falling back to pip"

# venv_create <venv-path>
venv_create() {
  local venv="$1"
  if command -v uv >/dev/null 2>&1 && uv venv "$venv" >/dev/null 2>&1; then
    return 0
  fi
  python3 -m venv --upgrade-deps "$venv"
}

# py_install <venv-path> <pkg-spec> <cache-dir>
# Retries transient failures 3x with backoff. Each caller gets its own cache
# dir so two parallel installs never contend on one.
py_install() {
  local venv="$1" spec="$2" cache="$3" max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== install attempt $a/$max: $spec ==="
    if command -v uv >/dev/null 2>&1; then
      if UV_CACHE_DIR="$cache" uv pip install --python "$venv/bin/python" --upgrade "$spec"; then
        return 0
      fi
    else
      if PIP_CACHE_DIR="$cache" "$venv/bin/pip" install --upgrade "$spec"; then
        return 0
      fi
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}
`
}
