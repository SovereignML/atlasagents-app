// Fail-fast platform config validation, run once at server boot alongside
// assertBillingConfig() (see src/instrumentation.ts). Billing/Stripe/app-URL
// checks live in src/lib/billing-config.ts — this file covers everything else
// critical: database, auth, email, secrets-at-rest, provisioning, and LLM
// provider config. Same contract as billing-config: THROW in production,
// warn-only in dev so local boots with a sparse .env.
//
// Keep this aligned with .env.example — every error here should map to a
// documented variable there.

const set = (name: string): boolean => !!process.env[name]?.trim()

/** INSTANCE_ENCRYPTION_KEY must decode to 32 bytes (same rule as crypto-secret.ts). */
function encryptionKeyProblem(): string | null {
  const raw = process.env.INSTANCE_ENCRYPTION_KEY?.trim()
  if (!raw) return "INSTANCE_ENCRYPTION_KEY is not set — instance-scoped secrets can't be encrypted."
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64")
  return key.length === 32
    ? null
    : `INSTANCE_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use 64 hex chars or 44 base64 chars.`
}

type CheckResult = { errors: string[]; warnings: string[] }

function collect(): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ── Core: database + auth ──
  if (!set("DATABASE_URL")) errors.push("DATABASE_URL is not set.")
  if (!set("AUTH_SECRET") && !set("NEXTAUTH_SECRET")) {
    errors.push("Neither AUTH_SECRET nor NEXTAUTH_SECRET is set — sessions can't be signed.")
  }

  // ── Email (Resend) — signup depends on verification emails ──
  if (!set("RESEND_API_KEY")) {
    errors.push("RESEND_API_KEY is not set — verification/reset/invite emails will silently not send.")
  }

  // ── Secrets at rest ──
  const encProblem = encryptionKeyProblem()
  if (encProblem) errors.push(encProblem)

  // ── Provisioning: active VPS provider + SSH fleet key ──
  const vmProvider = process.env.VM_PROVIDER?.trim() || "digitalocean"
  const providerVars: Record<string, string[]> = {
    digitalocean: ["DIGITALOCEAN_API_TOKEN"],
    linode: ["LINODE_API_TOKEN"],
    // OVH VPS product is account-scoped (no Cloud Project); these three signing
    // creds are all that's required. A default payment method on the account is
    // also needed for VPS ordering but can't be checked from here.
    ovh: ["OVH_APP_KEY", "OVH_APP_SECRET", "OVH_CONSUMER_KEY"],
  }
  for (const v of providerVars[vmProvider] ?? []) {
    if (!set(v)) errors.push(`${v} is not set — required for VM_PROVIDER=${vmProvider}.`)
  }
  if (!set("SSH_FLEET_PRIVATE_KEY") || !set("SSH_FLEET_PUBLIC_KEY")) {
    errors.push("SSH fleet keypair (SSH_FLEET_PRIVATE_KEY / SSH_FLEET_PUBLIC_KEY) is not set — instances can't be bootstrapped.")
  }

  // ── LLM provider ──
  const llmProvider = process.env.LLM_DEFAULT_PROVIDER?.trim() || "openrouter"
  if (llmProvider === "nvidia") {
    if (!set("NVIDIA_API_KEY_PRIMARY")) {
      errors.push("NVIDIA_API_KEY_PRIMARY is not set — required for LLM_DEFAULT_PROVIDER=nvidia.")
    }
  } else if (!set("OPENROUTER_API_KEY")) {
    errors.push("OPENROUTER_API_KEY is not set — required for LLM_DEFAULT_PROVIDER=openrouter.")
  }
  if (llmProvider === "openrouter" && !set("OPENROUTER_PROVISIONING_KEY")) {
    warnings.push(
      "OPENROUTER_PROVISIONING_KEY is not set — per-instance key minting disabled; instances fall back to the shared key.",
    )
  }

  // ── Cron tokens not covered by billing-config ──
  for (const v of ["UPTIME_SYNC_CRON_TOKEN", "AUDIT_RETENTION_CRON_TOKEN"]) {
    if (!set(v)) {
      warnings.push(`${v} is not set — the cron route it protects will reject every request.`)
    }
  }

  // ── Turnstile: half-configured is always a mistake ──
  if (set("NEXT_PUBLIC_TURNSTILE_SITE_KEY") !== set("TURNSTILE_SECRET_KEY")) {
    warnings.push(
      "Only one of NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY is set — Turnstile needs both (or neither).",
    )
  }

  // ── PostHog: optional analytics — warn only, never an error ──
  if (!set("NEXT_PUBLIC_POSTHOG_KEY")) {
    warnings.push(
      "NEXT_PUBLIC_POSTHOG_KEY is not set — product analytics, session replay, and feature flags are disabled.",
    )
    if (set("POSTHOG_KEY")) {
      warnings.push(
        "POSTHOG_KEY is set but NEXT_PUBLIC_POSTHOG_KEY is not — server events will fire with no client analytics (likely a misconfiguration).",
      )
    }
  }

  return { errors, warnings }
}

/**
 * Validate platform config. In production, throws on any hard error (boot
 * fails loudly). In non-production, logs and returns without throwing.
 */
export function assertEnv(): void {
  const isProd = process.env.NODE_ENV === "production"
  const { errors, warnings } = collect()

  for (const w of warnings) {
    console.warn(`[env-check] WARN: ${w}`)
  }

  if (!isProd) {
    // Dev/test: a sparse .env is expected; surface errors as warnings only.
    for (const e of errors) console.warn(`[env-check] WARN (prod error): ${e}`)
    return
  }

  if (errors.length > 0) {
    const msg =
      "Platform env is misconfigured for production. Fix these before serving traffic:\n" +
      errors.map((e) => `  • ${e}`).join("\n")
    throw new Error(msg)
  }
}
