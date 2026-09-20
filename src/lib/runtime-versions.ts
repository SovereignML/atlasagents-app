/**
 * Resolving a runtime's `latest` into a concrete, pinned version.
 *
 * Why this exists: every runtime package is installed as `latest` at bootstrap
 * (`OPENCLAW_VERSION` / `HERMES_VERSION` / `OPEN_WEBUI_VERSION` all fall back
 * to it, and none of the override keys are set in production). That has two
 * costs:
 *
 *  1. **Prefetching is impossible.** The BYOS prebake downloads packages when
 *     the customer connects their server and installs them when they later
 *     deploy. If the install resolves `latest` a second time, a release in
 *     between turns the warm cache into a miss and the prebake bought nothing.
 *     A pin is what makes "download now, install later" actually work.
 *  2. **Nothing records what a box runs.** There is no upgrade path and no
 *     version column, so the platform cannot answer "what version is this
 *     instance on" — the package is installed exactly once, at bootstrap, and
 *     then drifts out of anyone's knowledge.
 *
 * The split here is deliberate: the parsing and spec-building are pure and
 * unit-tested; only `resolve*Latest` touch the network. Nothing in this module
 * is called from inside a bootstrap script — a resolved version is baked into
 * the script as a literal, exactly like `RUNTIME_PKG_SPEC` already is.
 */

/** Registry endpoints. Fixed, first-party hosts — no SSRF surface to guard. */
const NPM_REGISTRY = "https://registry.npmjs.org"
const PYPI_JSON = "https://pypi.org/pypi"

/** A registry lookup should never hold up a connect. */
const RESOLVE_TIMEOUT_MS = 15_000

/**
 * The sentinel every runtime's version getter falls back to. Treated as "not
 * yet pinned" everywhere in this module.
 */
export const UNPINNED = "latest"

export function isPinned(version: string | null | undefined): boolean {
  return typeof version === "string" && version.trim() !== "" && version.trim() !== UNPINNED
}

/**
 * Accepts what the two registries actually publish: dotted numeric releases,
 * optionally with a pre-release/build suffix. Deliberately loose about the
 * shape beyond the first segment — `openclaw` uses CalVer (`2026.9.5`), Hermes
 * and Open WebUI use SemVer — but strict about the character set, because this
 * string is interpolated into a shell command inside the bootstrap.
 */
const VERSION_RE = /^[0-9]+(\.[0-9]+)*([A-Za-z0-9._+-]*)$/

export function isSafeVersion(version: string): boolean {
  return VERSION_RE.test(version) && version.length <= 64
}

/** `dist-tags.latest` out of an npm registry document. */
export function parseNpmLatest(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const tags = (body as { "dist-tags"?: unknown })["dist-tags"]
  if (!tags || typeof tags !== "object") return null
  const latest = (tags as { latest?: unknown }).latest
  if (typeof latest !== "string" || !isSafeVersion(latest)) return null
  return latest
}

/** `info.version` out of a PyPI JSON document. */
export function parsePypiLatest(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const info = (body as { info?: unknown }).info
  if (!info || typeof info !== "object") return null
  const version = (info as { version?: unknown }).version
  if (typeof version !== "string" || !isSafeVersion(version)) return null
  return version
}

/**
 * `<pkg>@<version>` for npm. An unpinned version yields `<pkg>@latest`, which
 * is exactly today's behaviour — so an unresolved pin degrades to the status
 * quo rather than failing a deploy.
 */
export function npmSpec(pkg: string, version: string | null | undefined): string {
  return `${pkg}@${isPinned(version) ? version!.trim() : UNPINNED}`
}

/**
 * `<dist>==<version>` for pip, or a bare `<dist>` when unpinned — matching the
 * existing `pipPackageSpec` / `openWebUiPipSpec` contract, where "latest" means
 * "say nothing and let the resolver pick".
 */
export function pypiSpec(dist: string, version: string | null | undefined): string {
  return isPinned(version) ? `${dist}==${version!.trim()}` : dist
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    // A resolver failure is never fatal: the caller falls back to `latest`,
    // which is what every install did before pinning existed.
    return null
  }
}

/** Concrete latest version of an npm package, or null if it cannot be resolved. */
export async function resolveNpmLatest(pkg: string): Promise<string | null> {
  return parseNpmLatest(await fetchJson(`${NPM_REGISTRY}/${encodeURIComponent(pkg)}`))
}

/** Concrete latest version of a PyPI distribution, or null. */
export async function resolvePypiLatest(dist: string): Promise<string | null> {
  return parsePypiLatest(await fetchJson(`${PYPI_JSON}/${encodeURIComponent(dist)}/json`))
}

/**
 * Resolve a version that may be an explicit env pin, `latest`, or absent.
 *
 * An operator-set `OPENCLAW_VERSION=2026.9.4` must win over the registry — that
 * is the whole point of the env override, and it is how a bad upstream release
 * gets rolled back without a deploy. Only `latest` goes to the network.
 */
export async function resolveVersion(
  configured: string,
  lookup: () => Promise<string | null>,
): Promise<string | null> {
  if (isPinned(configured)) return configured.trim()
  return await lookup()
}

/** Resolve `latest` against whichever index the package actually lives in. */
export async function resolveForRegistry(
  registry: "npm" | "pypi",
  pkg: string,
  configured: string,
): Promise<string | null> {
  return resolveVersion(configured, () =>
    registry === "npm" ? resolveNpmLatest(pkg) : resolvePypiLatest(pkg),
  )
}
