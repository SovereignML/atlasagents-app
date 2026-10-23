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

/** Where `uv` puts a CPython it downloads: outside /root, so the service users can run it. */
export const UV_PYTHON_DIR = "/opt/uv-python"

/**
 * `verify_python` for a given exclusive upper bound. Picks the interpreter the
 * venvs are built from and exports it as `PY_BIN`.
 *
 * The system `python3` is used when it is in range, then any `python3.X` on
 * PATH that is. When neither is (Ubuntu 26.04 ships 3.14, which hermes-agent
 * refuses), `uv` downloads the newest CPython the package accepts into
 * UV_PYTHON_DIR. Fails in seconds, naming the actual version, when none of that
 * works, rather than letting a doomed install run.
 *
 * Needs `buildPyInstallPrelude()` first, for `uv`.
 */
export function buildVerifyPythonStep(maxExclusive: string): string {
  const [maj, min] = maxExclusive.split(".").map((n) => Number.parseInt(n, 10))
  const floorMinor = Number.parseInt(PYTHON_MIN.split(".")[1], 10)
  const minors: string[] = []
  for (let m = min - 1; m >= floorMinor; m--) minors.push(`${maj}.${m}`)
  const newest = minors[0]
  return `step "verify_python"
py_in_range() {
  "$1" -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] < (${maj}, ${min}) else 1)' >/dev/null 2>&1
}
# An interpreter an earlier step of this script picked is kept when it fits, so
# Hermes and the chat UI on one box share one Python.
PY_BIN="\${PY_BIN:-}"
if [ -n "$PY_BIN" ] && ! py_in_range "$PY_BIN"; then PY_BIN=""; fi
[ -n "$PY_BIN" ] || for cand in python3 ${minors.map((v) => `python${v}`).join(" ")}; do
  p=$(command -v "$cand" 2>/dev/null) || continue
  if py_in_range "$p"; then PY_BIN="$p"; break; fi
done
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo none)
if [ -z "$PY_BIN" ] && command -v uv >/dev/null 2>&1; then
  echo "System Python is $PY_VER; fetching CPython ${newest} with uv"
  export UV_PYTHON_INSTALL_DIR=${bashSingleQuote(UV_PYTHON_DIR)} UV_PYTHON_BIN_DIR=${bashSingleQuote(`${UV_PYTHON_DIR}/bin`)}
  if uv python install ${newest}; then
    PY_BIN=$(uv python find --no-project ${newest} 2>/dev/null || true)
    chmod -R a+rX ${bashSingleQuote(UV_PYTHON_DIR)} 2>/dev/null || true
  fi
fi
if [ -z "$PY_BIN" ] || ! py_in_range "$PY_BIN"; then
  echo "Requires Python ${PYTHON_MIN}+ and older than ${maxExclusive}, found $PY_VER, and uv could not fetch ${newest}" >&2
  exit 1
fi
export PY_BIN
echo "using $PY_BIN ($("$PY_BIN" -V 2>&1))"`
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

# venv_create <venv-path>, from the interpreter verify_python picked (PY_BIN).
# A venv already built on that Python version is kept, so a redeploy or a
# prebaked box reuses its packages; one on another version is replaced.
venv_create() {
  local venv="$1" py="\${PY_BIN:-python3}" ver='import sys; print(sys.version_info[:2])'
  if [ -x "$venv/bin/python" ] && [ "$("$venv/bin/python" -c "$ver" 2>/dev/null)" = "$("$py" -c "$ver")" ]; then
    return 0
  fi
  if command -v uv >/dev/null 2>&1 && UV_VENV_CLEAR=1 uv venv --python "$py" "$venv" >/dev/null 2>&1; then
    return 0
  fi
  "$py" -m venv --clear --upgrade-deps "$venv"
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
