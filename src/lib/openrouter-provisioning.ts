// Thin wrapper around OpenRouter's Provisioning API.
//
// Used by the provisioner to mint a runtime API key per OpenClaw instance
// (name `Sovereign-OpenClaw-<slug>`, human-readable in the OpenRouter
// dashboard — note OpenRouter calls this the key `name`; its `label` field is
// the masked key string), and by the reconciler to revoke orphaned keys. The reconciler
// matches keys by their persisted keyId (`instances.openRouterKeyId`), not by
// the label, so the label is free to be a cosmetic, human-friendly string.
// Mirrors the shape of src/lib/cloudflare.ts: a single authenticated fetch
// helper plus typed verbs.
//
// The OPENROUTER_PROVISIONING_KEY env var is the parent account key with
// provisioning scope. It is the ONLY OpenRouter credential that stays on
// the control plane — bot VMs receive only their own minted runtime key.
//
// Docs: https://openrouter.ai/docs/features/provisioning-api-keys

const OPENROUTER_API = "https://openrouter.ai/api/v1"

export type ProvisioningError = Error & {
  status?: number
  retryAfter?: number
}

function provisioningKey(): string {
  const k = process.env.OPENROUTER_PROVISIONING_KEY
  if (!k) {
    throw new Error(
      "OPENROUTER_PROVISIONING_KEY is not set. Required for minting per-instance OpenRouter runtime keys.",
    )
  }
  return k
}

async function orFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${OPENROUTER_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${provisioningKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  let body: { data?: unknown; error?: { message?: string; code?: number } } = {}
  try {
    body = await res.json()
  } catch {
    // non-JSON; leave body empty so we surface res.statusText
  }
  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText
    const err = new Error(`OpenRouter ${res.status}: ${msg}`) as ProvisioningError
    err.status = res.status
    if (res.status === 429) {
      const ra = res.headers.get("retry-after")
      err.retryAfter = ra ? Number(ra) : 5
    }
    throw err
  }
  return body.data as T
}

export type MintArgs = {
  /** Human-readable label shown in the OpenRouter dashboard; we use
   *  `Sovereign-OpenClaw-<slug>`. The reconciler matches ours by keyId, not this. */
  label: string
  /** Optional USD spend cap enforced on OpenRouter's side. Belt-and-suspenders only; wallet remains authoritative. */
  limitUsd?: number
}

export type MintResult = {
  /** OpenRouter's internal id for the key, used for revoke/list. Persisted as `instances.openRouterKeyId`. */
  keyId: string
  /** The runtime `sk-or-v1-...` key. Returned exactly once at mint time. */
  key: string
}

/**
 * Mint a new runtime API key under the parent provisioning key.
 * The returned `key` is shown only once — callers MUST persist it (encrypted)
 * immediately or it is lost.
 */
export async function mintRuntimeKey(
  args: MintArgs,
  /**
   * Override the parent provisioning key. Used for white-label reseller agents,
   * which mint under the TENANT's own OpenRouter account (so the tenant bears
   * their customers' LLM cost) instead of the platform key.
   */
  provisioningKeyOverride?: string,
): Promise<MintResult> {
  const parentKey = provisioningKeyOverride || provisioningKey()
  const payload: Record<string, unknown> = { name: args.label }
  if (args.limitUsd != null) payload.limit = args.limitUsd

  // The Provisioning API returns the new key + metadata under `data`. The
  // raw response includes `key` (cleartext, once) at the top level and
  // metadata (`data.hash`, `data.label`, etc.) under `data`. We normalize.
  type RawResponse = {
    key: string
    data: { hash: string; name: string; label?: string }
  }
  const res = await fetch(`${OPENROUTER_API}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${parentKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  let raw: Partial<RawResponse> & { error?: { message?: string } } = {}
  try {
    raw = await res.json()
  } catch {
    // non-JSON
  }
  if (!res.ok || !raw.key || !raw.data?.hash) {
    const msg = raw.error?.message ?? res.statusText
    const err = new Error(`OpenRouter mint ${res.status}: ${msg}`) as ProvisioningError
    err.status = res.status
    throw err
  }
  return { keyId: raw.data.hash, key: raw.key }
}

/**
 * Revoke a previously-minted runtime key. Idempotent on the caller's side:
 * a 404 (key already gone) is treated as success so reconciler retries
 * don't loop. All other errors throw.
 *
 * `provisioningKeyOverride` authenticates the DELETE against a specific
 * account. Reseller (tenant-keyed) runtime keys live on the TENANT's OpenRouter
 * account, so they must be revoked with the tenant's provisioning key — the
 * platform key returns 404 for them and would silently leave the key live and
 * spendable. Defaults to the platform provisioning key for normal instances.
 */
export async function revokeRuntimeKey(
  keyId: string,
  provisioningKeyOverride?: string,
): Promise<void> {
  const res = await fetch(`${OPENROUTER_API}/keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${provisioningKeyOverride ?? provisioningKey()}` },
  })
  if (res.ok || res.status === 404) return
  let body: { error?: { message?: string } } = {}
  try {
    body = await res.json()
  } catch {
    // non-JSON
  }
  const msg = body.error?.message ?? res.statusText
  const err = new Error(`OpenRouter revoke ${res.status}: ${msg}`) as ProvisioningError
  err.status = res.status
  throw err
}

/**
 * Update a runtime key's spend cap and/or enabled state.
 * `limit` is the cumulative USD lifetime cap (null clears it); `disabled`
 * hard-stops the key. Idempotent on the caller's side: a 404 (key already
 * gone) is treated as success so the reconciler's retries don't loop.
 */
export async function updateRuntimeKey(
  keyId: string,
  patch: { limit?: number | null; disabled?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.limit !== undefined) body.limit = patch.limit
  if (patch.disabled !== undefined) body.disabled = patch.disabled

  const res = await fetch(`${OPENROUTER_API}/keys/${encodeURIComponent(keyId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${provisioningKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (res.ok || res.status === 404) return
  let parsed: { error?: { message?: string } } = {}
  try {
    parsed = await res.json()
  } catch {
    // non-JSON
  }
  const msg = parsed.error?.message ?? res.statusText
  const err = new Error(`OpenRouter update ${res.status}: ${msg}`) as ProvisioningError
  err.status = res.status
  throw err
}

export type RuntimeKeyState = {
  /** Human-readable name we set at mint (e.g. `Sovereign-OpenClaw-<slug>`). */
  label: string
  keyId: string
  /** Cumulative real USD spent on this key (lifetime). */
  usageUsd: number
  /** Cumulative USD spend cap, or null if uncapped. */
  limitUsd: number | null
  disabled: boolean
}

/**
 * Fetch a single runtime key's current state, including its cumulative real
 * spend (`usage`) and cap (`limit`). Used by the usage-sync poller to charge
 * the wallet for real OpenRouter spend and by the reconciler to detect cap
 * drift.
 *
 * NOTE on OpenRouter's field naming: the API returns `name` as the
 * human-readable name we set at mint, while `label` is the MASKED KEY STRING
 * (`sk-or-v1-...`). We expose the human name as our `label`, so read it from
 * `data.name` first (falling back to `data.label` only for legacy keys minted
 * without a name).
 */
export async function getRuntimeKey(keyId: string): Promise<RuntimeKeyState> {
  type RawKey = {
    hash: string
    name: string
    label?: string
    usage?: number
    limit?: number | null
    disabled?: boolean
  }
  const data = await orFetch<RawKey>(`/keys/${encodeURIComponent(keyId)}`)
  return {
    keyId: data.hash,
    label: data.name ?? data.label,
    usageUsd: typeof data.usage === "number" ? data.usage : 0,
    limitUsd: typeof data.limit === "number" ? data.limit : null,
    disabled: data.disabled ?? false,
  }
}

export type ListedKey = {
  keyId: string
  /** Human-readable name we set at mint (from OpenRouter's `name` field, NOT
   *  its `label`, which is the masked key string). The reconciler matches our
   *  keys by the `sovereign-` prefix on this value. */
  label: string
  disabled?: boolean
  /** Cumulative USD spend cap, or null if uncapped. Lets the reconciler
   *  detect cap drift without a per-key GET. */
  limitUsd?: number | null
  /** Key creation time as epoch ms, or null if OpenRouter omitted it. Lets the
   *  reconciler skip revoking freshly-minted keys during the mint→persist race. */
  createdAtMs?: number | null
}

/**
 * List all runtime keys under the parent provisioning key. Used by the
 * reconciler to find OpenRouter-side orphans (our keys whose keyId matches no
 * non-deleted instance row) and to self-heal cap drift.
 */
export async function listRuntimeKeys(): Promise<ListedKey[]> {
  type RawKey = {
    hash: string
    name: string
    label?: string
    disabled?: boolean
    limit?: number | null
    created_at?: string | null
  }
  const data = await orFetch<RawKey[]>(`/keys`)
  return data.map((k) => {
    const created = k.created_at ? Date.parse(k.created_at) : NaN
    return {
      keyId: k.hash,
      // OpenRouter's `name` is the human name we set; `label` is the masked key
      // string. Read `name` first so the reconciler's `sovereign-` prefix match works.
      label: k.name ?? k.label,
      disabled: k.disabled,
      limitUsd: typeof k.limit === "number" ? k.limit : null,
      createdAtMs: Number.isNaN(created) ? null : created,
    }
  })
}
