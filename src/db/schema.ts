// Drizzle schema — single source of truth for the Postgres database.
//
// `drizzle-kit push` syncs this file → Postgres. No migration lockfile,
// no `migrate deploy`, no codegen step.

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  primaryKey,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const cuid = () => text().$defaultFn(() => createId())

const now = () => timestamp({ mode: "date", withTimezone: false }).defaultNow().notNull()

// ──────────────────────────────────────────────────────────────────────
// User / auth
// ──────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "User",
  {
    id: cuid().primaryKey(),
    name: text(),
    email: text().notNull(),
    emailVerified: timestamp({ mode: "date", withTimezone: false }),
    hashedPassword: text(),
    image: text(),
    role: text().default("user").notNull(),
    isBanned: boolean().default(false).notNull(),
    bannedAt: timestamp({ mode: "date", withTimezone: false }),
    bannedReason: text(),
    telegramId: text(),
    twitterHandle: text(),
    discordId: text(),
    stripeCustomerId: text(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    // DEPRECATED — dead column. The `Wallet` is the sole source of truth for
    // credit balances; nothing reads or writes this for billing (the old
    // dual-write was removed — see stripe-events.ts). Kept only to avoid a
    // destructive drop mid-flight; remove it together with the bigint Commit 3
    // (drop the float wallet columns) in one migration. See src/lib/wallet.ts.
    credits: integer().default(0).notNull(),
    // Per-user override for the free-tier lifetime agent allowance
    // (FREE_LIFETIME_LIMIT). Null = use the platform default. Admin-settable
    // from the user detail page (/admin/users/[userId]). See src/lib/free-tier.ts.
    freeAgentLimit: integer(),
    activeTeamId: text(),
    // Two-factor authentication (TOTP, RFC 6238).
    //   `twoFactorSecret`       — base32 secret, encrypted at rest with INSTANCE_ENCRYPTION_KEY.
    //   `twoFactorEnabled`      — flips to true only after the user verifies a code post-enroll.
    //   `twoFactorBackupCodes`  — bcrypt hashes of one-time backup codes; consumed on use.
    twoFactorSecret: text(),
    twoFactorEnabled: boolean().default(false).notNull(),
    twoFactorBackupCodes: jsonb().$type<string[]>(),
    twoFactorEnrolledAt: timestamp({ mode: "date", withTimezone: false }),
    // Ad-conversion tracking. Click IDs are captured first-party on landing and
    // read at conversion time by the server-side Meta CAPI + Google Data Manager
    // senders — the Stripe purchase webhook has no browser, so these stored IDs
    // are what make a paid conversion attributable. See src/lib/ads.
    fbclid: text(),
    gclid: text(),
    adClickCapturedAt: timestamp({ mode: "date", withTimezone: false }),
    // Cookie-consent decision (GDPR). null = undecided. Gates whether any
    // ad-conversion data is transmitted to Meta/Google. See src/lib/consent.
    marketingConsent: boolean(),
    consentUpdatedAt: timestamp({ mode: "date", withTimezone: false }),
    // Set when an admin closes the account (src/lib/account-closure.ts). Users
    // are never hard-deleted: their wallet, credit ledger, subscriptions, usage
    // and audit trail are kept for accounting, chargebacks and investigations,
    // and the personal fields on this row are anonymized instead.
    deletedAt: timestamp({ mode: "date", withTimezone: false }),
  },
  (t) => [
    uniqueIndex("User_email_key").on(t.email),
    uniqueIndex("User_stripeCustomerId_key").on(t.stripeCustomerId),
  ],
)

// Auth.js / NextAuth adapter tables — column names & PKs follow the
// DrizzleAdapter defaults so the adapter typechecks cleanly.

export const accounts = pgTable(
  "Account",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [
    primaryKey({
      columns: [t.provider, t.providerAccountId],
      name: "Account_pkey",
    }),
  ],
)

export const sessions = pgTable("Session", {
  sessionToken: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ mode: "date", withTimezone: false }).notNull(),
})

export const verificationTokens = pgTable(
  "VerificationToken",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: "date", withTimezone: false }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.identifier, t.token],
      name: "VerificationToken_pkey",
    }),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Billing
// ──────────────────────────────────────────────────────────────────────

export const plans = pgTable(
  "Plan",
  {
    id: cuid().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    tier: text().notNull(),
    stripePriceIdMonthly: text(),
    stripePriceIdYearly: text(),
    features: jsonb().notNull(),
    isActive: boolean().default(true).notNull(),
    sortOrder: integer().default(0).notNull(),
    creditsPerPeriod: integer().default(0).notNull(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("Plan_slug_key").on(t.slug)],
)

export const subscriptions = pgTable(
  "Subscription",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      // restrict, not cascade: users are closed, never hard-deleted
      // (src/lib/account-closure.ts), so the money and audit trail survives.
      .references(() => users.id, { onDelete: "restrict" }),
    // Nullable: platform subscriptions reference a platform Plan, but reseller
    // (connected-account) subscriptions are priced on the TENANT's own Stripe
    // and don't map to a platform plan — those rows leave planId null and carry
    // connectAccountId + teamId instead.
    planId: text().references(() => plans.id),
    instanceId: text().references(() => instances.id),
    stripeSubscriptionId: text(),
    stripePriceId: text(),
    interval: text().default("month").notNull(),
    status: text().default("incomplete").notNull(),
    currentPeriodEnd: timestamp({ mode: "date", withTimezone: false }),
    // Yearly plans prepay 12 months but we DRIP the monthly allotment: this marks
    // when the next monthly credit grant is due. NULL for monthly subs (Stripe's
    // monthly invoice handles the renewal deposit) and once a yearly period is
    // fully dripped (the annual renewal invoice re-seeds it). Driven by the
    // monthly-grants sweep — see src/lib/monthly-grants.ts.
    nextCreditGrantAt: timestamp({ mode: "date", withTimezone: false }),
    cancelAtPeriodEnd: boolean().default(false).notNull(),
    // Reseller billing (Phase 6). NULL = a platform subscription (today's
    // behavior, billed on the platform's own Stripe). Non-null = a child
    // end-customer subscription billed on the TENANT's connected Stripe account;
    // `teamId` is the child end-customer team it entitles. These rows must NOT
    // fund the platform wallet (the money is the tenant's). See
    // src/lib/stripe-connect-events.ts.
    connectAccountId: text(),
    teamId: text().references(() => teams.id),
    // LEGACY per-server BYOS plan. BYOS plans are now one per agent (instanceId
    // set, or NULL while the plan is available — see src/lib/byos-plan.ts) and never
    // set this. A row that does was bought for a connected server before that
    // change and is grandfathered: it covers every agent on the server until it
    // ends. SET NULL so a hard-deleted server can't take the billing record
    // with it — disconnect is refused while such a plan will renew.
    byosServerId: text().references(() => byosServers.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("Subscription_instanceId_key").on(t.instanceId),
    uniqueIndex("Subscription_stripeSubscriptionId_key").on(t.stripeSubscriptionId),
    index("Subscription_userId_idx").on(t.userId),
    index("Subscription_status_idx").on(t.status),
    index("Subscription_teamId_idx").on(t.teamId),
    index("Subscription_byosServerId_idx").on(t.byosServerId),
    // The monthly-grants sweep scans due yearly drips by this column.
    index("Subscription_nextCreditGrantAt_idx").on(t.nextCreditGrantAt),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Regions / server configs / ssh keys
// ──────────────────────────────────────────────────────────────────────

export const regions = pgTable(
  "Region",
  {
    id: cuid().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    country: text().notNull(),
    flag: text().notNull(),
    available: boolean().default(true).notNull(),
    sortOrder: integer().default(0).notNull(),
    providerRegion: text().default("us-east").notNull(),
  },
  (t) => [uniqueIndex("Region_slug_key").on(t.slug)],
)

export const serverConfigs = pgTable(
  "ServerConfig",
  {
    id: cuid().primaryKey(),
    slug: text().notNull(),
    category: text().notNull(),
    label: text().notNull(),
    vcpu: integer().notNull(),
    ramGb: integer().notNull(),
    storageGb: integer().notNull(),
    priceMonthly: doublePrecision().notNull(),
    priceYearly: doublePrecision().notNull(),
    sortOrder: integer().default(0).notNull(),
    isActive: boolean().default(true).notNull(),
    providerPlan: text().default("g6-standard-2").notNull(),
  },
  (t) => [uniqueIndex("ServerConfig_slug_key").on(t.slug)],
)

export const sshKeys = pgTable(
  "SshKey",
  {
    id: cuid().primaryKey(),
    // Team that owns this key (shared across members). Set at add time =
    // the adder's active team. `userId` is retained as "added by" attribution.
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    publicKey: text().notNull(),
    fingerprint: text().notNull(),
    createdAt: now(),
  },
  (t) => [
    index("SshKey_teamId_idx").on(t.teamId),
    index("SshKey_userId_idx").on(t.userId),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Instances (the big one)
// ──────────────────────────────────────────────────────────────────────

export const instances = pgTable(
  "Instance",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Team this agent belongs to. Set at deploy time = the creator's active
    // team. Drives the owner god-view and team-shared provider resolution
    // (backups/domains use this team's Drive/Cloudflare connection).
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    regionId: text()
      .notNull()
      .references(() => regions.id),
    serverConfigId: text()
      .notNull()
      .references(() => serverConfigs.id),
    sshKeyId: text().references(() => sshKeys.id),
    storageGb: integer().notNull(),
    billingInterval: text().default("month").notNull(),
    // State machine — see src/lib/instance-state.ts for the transition table.
    // Legal values: pending | provisioning | running | stopped |
    //               failed_provisioning | deleting | deleted
    status: text().default("pending").notNull(),
    ipAddress: text(),
    // Public IP this instance held when its VM was released back to the
    // provider pool. Copied from `ipAddress` at delete/teardown time (which
    // then nulls `ipAddress`, so live gateway/DNS/status consumers that guard
    // on `!ipAddress` or `status === 'deleted'` are unaffected). Retained for
    // audit + dangling-DNS / IP-reuse review. Set on every `→ deleted`
    // transition (deleteBot + reconciler) and on failed/stuck VM teardown.
    deletedIpAddress: text(),
    rootPasswordEnc: text(),
    stripeSubscriptionId: text(),

    // State machine bookkeeping
    lastTransitionAt: timestamp({ mode: "date", withTimezone: false }),
    provisionAttempts: integer().default(0).notNull(),
    deletionAttempts: integer().default(0).notNull(),
    lastError: text(),
    reconciledAt: timestamp({ mode: "date", withTimezone: false }),

    // Bot Factory fields
    agentType: text(),
    agentConfig: jsonb(),
    soulMd: text(),
    skills: jsonb(),
    /**
     * Catalog tool ids enabled on this agent (e.g. ["browser"]). Drives the
     * runtime config render (browser/tools sections) + system-dep installs.
     * See src/configs/agent-tools.ts. Readers coerce `?? []` defensively.
     */
    enabledTools: jsonb()
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    modelTier: text(),
    // Per-instance model override (OpenRouter slug). NULL → use the tier default
    // (hermesModel(tier) for Hermes, routeModel(tier).model for OpenClaw). Set by
    // the user via the Controls "Model" picker; validated against the runtime's
    // selectable allowlist. See effectiveModel() in src/lib/model-router.ts.
    modelSlug: text(),
    botToken: text(),
    // SSH host key fingerprint pinned on first successful connect (TOFU).
    // Format: "sha256:<base64>". Subsequent SSH calls verify against this;
    // mismatch = abort. See src/lib/ssh.ts connectAndPin().
    sshHostFingerprint: text(),
    lastActiveAt: timestamp({ mode: "date", withTimezone: false }),
    /**
     * Demo auto-expiry deadline. Set for Free-tier agents (now + FREE_DEMO_TTL_MS)
     * at creation and re-stamped when the agent goes live. NULL = no auto-expiry
     * (all paid plans). A non-null value is the "this is a demo agent" signal the
     * reaper (src/lib/demo-reaper.ts) and the dashboard countdown key off of.
     */
    expiresAt: timestamp({ mode: "date", withTimezone: false }),
    /** Set when status becomes `deleted` — used for admin audit / sorting */
    deletedAt: timestamp({ mode: "date", withTimezone: false }),
    deploymentTarget: text(),
    // Agent runtime engine for the VPS path: "openclaw" (default) | "hermes".
    // NULL on pre-existing rows; getRuntime() coerces NULL -> "openclaw".
    runtime: text().default("openclaw"),
    /**
     * The concrete runtime package version this box was provisioned with, as
     * resolved and pinned at bootstrap. NULL on every instance provisioned
     * before pinning existed — those installed whatever `latest` was that day
     * and there is no way to recover it short of asking the box.
     *
     * The platform has never recorded this: the package is installed exactly
     * once, at bootstrap, and there is no upgrade path. See
     * src/lib/runtime-versions.ts.
     */
    runtimeVersion: text(),
    /** Same, for the Open WebUI sidecar when `webuiEnabled`. */
    sidecarVersion: text(),
    // LLM provider override: "openrouter" | "nvidia". NULL → platform default
    // (LLM_DEFAULT_PROVIDER, else "openrouter"). See resolveLlmProvider().
    llmProvider: text(),
    // Hermes-only: provision Open WebUI as a Docker sidecar fronting the gateway
    // so the user gets a web chat UI. For Hermes+webui the dormant
    // openclawAdmin* columns below hold the Open WebUI admin login.
    webuiEnabled: boolean().default(false).notNull(),
    // Which chat UI `webuiEnabled` installs: "agentwebui-lite", or NULL for
    // Open WebUI (every agent made before Lite). Fixed at creation from
    // CHAT_UI, so a reprovision keeps the UI the box has. See
    // src/lib/runtimes/agentwebui-lite.ts.
    chatUi: text(),
    interfaceKind: text(),
    telegramBotTokenEnc: text(),
    telegramUsername: text(),
    // Telegram webhook routing + verification. We no longer put the bot token
    // in the webhook URL (it leaked into proxy/CDN logs). Telegram POSTs to
    // /tg/<telegramWebhookId> (a non-secret random id) and includes our secret
    // in the X-Telegram-Bot-Api-Secret-Token header, which we verify against
    // telegramWebhookSecretEnc (AES-GCM at rest). NULL on legacy rows connected
    // before this change — those still resolve via the /tg/<botToken> path
    // until reconnected.
    telegramWebhookId: text(),
    telegramWebhookSecretEnc: text(),
    botHostId: text().references(() => botHosts.id),
    containerName: text(),
    containerPort: integer(),
    vmId: text(),
    // Which VPS provider owns `vmId`. NULL for legacy/shared/byos rows, which
    // fall back to the env-default provider (Linode). The router writes this on
    // a successful create so delete + reconcile call the right provider's API.
    // See src/lib/vps-router and src/lib/providers.
    providerId: text().references((): AnyPgColumn => providers.id),

    // OpenClaw agent deploy — dns/tls are only populated when a domain is
    // configured. NULL = "not applicable", never synthesize a fake value.
    domain: text(),
    dnsStatus: text(),
    tlsStatus: text(),
    managedSubdomain: text(),
    cfRecordId: text(),
    // Bring-Your-Own-Cloudflare: when an agent is put on a domain in the
    // user's OWN Cloudflare zone (see src/lib/cloudflare.ts + the
    // cloudflare-domain route), we record the user's zone id and the
    // user-zone A-record id so we can patch/delete it later with the user's
    // token. Kept separate from cfRecordId (platform managed subdomain) — an
    // instance can have both. domainProxied flags the orange-cloud path so
    // dns-status/Caddy rendering branch correctly.
    cfZoneId: text(),
    cfUserRecordId: text(),
    domainProxied: boolean().default(false).notNull(),
    openclawAdminEmail: text(),
    openclawAdminPasswordEnc: text(),
    gatewayTokenEnc: text(),
    // Per-instance event-ingest bearer token (AES-GCM at rest), minted at
    // provision time and injected into the agent env as
    // PLATFORM_EVENT_INGEST_TOKEN. SEPARATE from gatewayTokenEnc for least
    // privilege: a leaked ingest token can only POST observability events to
    // /api/instances/<id>/events, never reach the gateway. NULL on rows
    // provisioned before this column existed — backfilled on next reprovision.
    eventIngestTokenEnc: text(),

    // n8n companion service (the "n8n" tool). Both are minted on first enable
    // and REUSED on every reprovision — never regenerated. n8nEncryptionKeyEnc
    // is n8n's N8N_ENCRYPTION_KEY: n8n encrypts its saved workflow credentials
    // with it, so rotating it would orphan them. n8nOwnerPasswordEnc is the
    // seeded owner login for the n8n UI (surfaced to the user and used by the
    // agent's browser control). AES-GCM at rest; NULL until the tool is enabled.
    // See syncToolServices() in src/lib/provisioner.ts and src/lib/runtimes/n8n-service.ts.
    n8nEncryptionKeyEnc: text(),
    n8nOwnerPasswordEnc: text(),

    // Per-instance OpenRouter runtime key, minted via OpenRouter's
    // Provisioning API at provision time and revoked on delete. Replaces the
    // shared platform key that used to be baked into every VM's .env. The
    // parent OPENROUTER_PROVISIONING_KEY env var (used to mint these) is the
    // only OpenRouter credential that remains platform-wide and never lands
    // on a bot VM. See src/lib/openrouter-provisioning.ts and the
    // `getOrMintInstanceOpenRouterKey` helper in src/lib/provisioner.ts.
    //
    // Nullable: existing instances keep using the legacy shared key in their
    // on-disk /opt/openclaw/.env until they're naturally reprovisioned
    // (Restart, env change), at which point reprovisionBotEnv mints fresh.
    openRouterKeyId: text(),
    openRouterKeyEnc: text(),
    // Real-usage credit billing for the minted key. `openRouterUsageUsd` is
    // the last-polled cumulative real OpenRouter spend (USD) for this key; the
    // usage-sync poller charges the wallet for the delta since the last poll
    // and advances this. `openRouterLimitUsd` is the spend cap we last set on
    // the key (= lifetime funded × margin), kept for drift detection /
    // self-heal in the reconciler. See src/lib/openrouter-usage.ts.
    //
    // IMPORTANT: for instances that already had a key before this column
    // existed, `openRouterUsageUsd` MUST be seeded to the key's current
    // OpenRouter usage (scripts/backfill-openrouter-usage.ts) or the first
    // poll will double-charge all historical spend.
    openRouterUsageUsd: doublePrecision().default(0).notNull(),
    openRouterLimitUsd: doublePrecision(),
    // True when this agent's runtime key was minted against a white-label
    // TENANT's own OpenRouter account (not the platform's). Set at mint time in
    // getOrMintInstanceOpenRouterKey. The single source of truth for "this key
    // lives on a tenant account" — the usage poller and wallet cap-sync SKIP
    // these (the platform provisioning key can't read them, and the tenant bears
    // the cost), and the revoke path resolves the tenant key by teamId to
    // actually delete them. Replaces the fragile child-only JOIN heuristic.
    tenantKeyed: boolean().default(false).notNull(),

    // Bring Your Own Server (BYOS) — populated only when
    // deploymentTarget = "byos". The user runs their own server and pastes
    // our SSH_FLEET_PUBLIC_KEY into its root authorized_keys; we connect with
    // the fleet private key (same path as the Linode VPS flow, minus VM
    // creation). No user SSH secret is stored.
    //
    // The server this agent runs on. Agents are installed ONTO an already-
    // connected ByosServer, so this is the connection's source of truth; the
    // byosHost/byosPort/byosUser columns below are denormalized copies kept in
    // sync from the server row so existing read paths (and the SSH target
    // helper) keep working unchanged.
    byosServerId: text().references(() => byosServers.id, { onDelete: "set null" }),
    byosHost: text(),
    byosPort: integer().default(22),
    byosUser: text().default("root"),
    // "managed_credits" (user buys OpenRouter credits from us — we mint a
    // per-instance key as usual) | "own_key" (user brings their own LLM API
    // key, stored encrypted in byosOwnApiKeyEnc and injected instead of
    // minting).
    byosLlmMode: text(),
    byosOwnApiKeyEnc: text(),
    // Which LLM provider the own_key is for. Catalog id from
    // src/configs/llm-providers.ts: "openrouter" | "openai" | "nvidia" |
    // "groq" | "deepseek" | "custom". NULL on legacy own_key rows ⇒ resolved
    // to "openrouter" (the historical assumption). Non-openrouter providers
    // require the Hermes runtime (enforced at the API + defensively in the
    // provisioner) — OpenClaw's package is hardwired to OpenRouter.
    byosOwnProvider: text(),
    // OpenAI-compatible base URL — ONLY populated when byosOwnProvider =
    // "custom". For catalog providers the base URL comes from the catalog.
    byosOwnBaseUrl: text(),
    // Optional user-supplied FALLBACK key — the user's OWN second provider/key,
    // NOT our managed key. A BYO-key agent NEVER falls back to our minted
    // OpenRouter key; managed access exists only via byosLlmMode="managed_credits".
    // NULL byosFallbackProvider = no fallback configured. The key is AES-GCM
    // encrypted at rest; byosFallbackBaseUrl is set only for a "custom" fallback.
    byosFallbackProvider: text(),
    byosFallbackApiKeyEnc: text(),
    byosFallbackBaseUrl: text(),
    // Which key slot is currently written to the box: "primary" | "fallback".
    // NULL ⇒ "primary". The "switch to fallback" action flips this and
    // reprovisions the .env; resolveByosLlmCredentials() reads it so the swap is
    // idempotent and reversible. See src/app/api/instances/[instanceId]/byos-key/route.ts.
    byosActiveKeySlot: text(),
    // Last observed status of the active key: "unknown" | "ok" | "failing".
    // NULL ⇒ "unknown". Drives the status pill on the instance detail page.
    byosKeyStatus: text(),

    // Uptime Kuma monitoring (operator-owned Kuma, configured via env). When an
    // instance reaches `running` we create a Kuma HTTP monitor pointing at its
    // public gateway URL and store its numeric id here; the uptime-sync poller
    // scrapes Kuma's /metrics and writes the latest snapshot into the columns
    // below. All NULL when the feature is unconfigured or the first poll hasn't
    // run yet. See src/lib/uptime-kuma.ts + src/lib/uptime-monitoring.ts.
    kumaMonitorId: integer(),
    kumaStatus: text(), // "up" | "down" | "pending" | "maintenance"
    kumaResponseTimeMs: integer(),
    kumaUptimeRatio: doublePrecision(), // 24h window, 0–1
    kumaCertDaysRemaining: integer(),
    kumaCheckedAt: timestamp({ mode: "date", withTimezone: false }),

    // Last time the agent POSTed an observability event to the ingest endpoint.
    // Distinct from lastActiveAt (which tracks end-user interaction); this
    // tracks the event pipeline's liveness. NULL until the first event lands.
    lastEventAt: timestamp({ mode: "date", withTimezone: false }),

    // Server hardware snapshot — the real box behind this instance, probed over
    // SSH by the metrics collector (src/lib/server-metrics.ts) on a cron cadence
    // and on-demand. Distinct from serverConfigs.vcpu/ramGb (nominal plan tier,
    // and 0 for BYOS): these are the measured values from the live server. All
    // NULL until the first probe runs. hwHealth is "reachable" | "unreachable";
    // hwError holds the last probe failure message (specs are NOT cleared on a
    // failed probe so the last-known values stay visible).
    hwCpuCores: integer(),
    hwCpuLoad1: doublePrecision(),
    hwRamTotalMb: integer(),
    hwRamUsedMb: integer(),
    hwDiskTotalGb: integer(),
    hwDiskUsedGb: integer(),
    hwOsName: text(),
    hwOsVersion: text(),
    hwKernel: text(),
    hwUptimeSec: integer(),
    hwHealth: text(),
    hwCheckedAt: timestamp({ mode: "date", withTimezone: false }),
    hwError: text(),

    provisionStage: text(),
    failedStage: text(),

    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Partial index so deleting an instance frees its slug for reuse.
    // Without the `WHERE deletedAt IS NULL` clause, creating an instance
    // with the same name as a soft-deleted one would fail with a unique
    // violation. If drizzle-kit's push doesn't emit the WHERE clause,
    // apply the index manually via SQL — see docs in plan-and-fix.
    uniqueIndex("Instance_slug_key").on(t.slug).where(sql`"deletedAt" IS NULL`),
    uniqueIndex("Instance_stripeSubscriptionId_key").on(t.stripeSubscriptionId),
    uniqueIndex("Instance_botToken_key").on(t.botToken),
    uniqueIndex("Instance_telegramWebhookId_key").on(t.telegramWebhookId),
    index("Instance_userId_idx").on(t.userId),
    index("Instance_teamId_idx").on(t.teamId),
    index("Instance_status_idx").on(t.status),
    index("Instance_botHostId_idx").on(t.botHostId),
  ],
)

// Per-agent access grants (the ACL). A row means `userId` may access
// `instanceId` at `level`. Visibility = creator OR team owner OR a grant
// here (see src/lib/instance-queries.ts). Levels: viewer < operator < manager.
export const instanceAccess = pgTable(
  "InstanceAccess",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: text().notNull(), // "viewer" | "operator" | "manager"
    grantedById: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("InstanceAccess_instanceId_userId_key").on(t.instanceId, t.userId),
    index("InstanceAccess_instanceId_idx").on(t.instanceId),
    index("InstanceAccess_userId_idx").on(t.userId),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Bring Your Own Server — the customer's machine as a first-class object.
//
// A BYOS server used to BE an Instance row: byosHost/byosPort/byosUser were
// columns on it, so "a server" and "an agent" were the same thing and neither
// could exist without the other. That forced the customer to pay before we had
// ever touched the box — and we only discovered it was incompatible afterwards.
//
// Now: connecting a server is free and creates one of these rows. We SSH in,
// verify access, read the real hardware, and show it. Agents reference the
// server (instances.byosServerId) and are what actually costs money. One server
// is designed to hold several agents, and nothing caps that today: the
// install endpoint does NOT limit agents per server. `capacityAgents` and the
// "room for about N" line it drives are advisory sizing only — a customer's
// own hardware is theirs to overcommit. (Earlier revisions of this comment
// claimed v1 enforced one agent per server. It never did.)
//
// No customer SSH secret is ever stored — we authenticate with the platform
// fleet key, which they install themselves.
// ──────────────────────────────────────────────────────────────────────
export const byosServers = pgTable(
  "ByosServer",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // Who connected it. Kept alongside teamId for attribution; ownership and
    // access control are team-scoped, matching instances.
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** User-facing name; defaults to the host when they don't supply one. */
    label: text().notNull(),

    // --- Connection ---
    host: text().notNull(),
    port: integer().default(22).notNull(),
    sshUser: text().default("root").notNull(),
    /**
     * Whether privileged commands need `sudo -n` on this box. Resolved live at
     * connect time (id -u, then sudo -n true) and PERSISTED — it used to be
     * computed inline during provisioning and thrown away, so every later
     * operation on a non-root server ran unprivileged and failed.
     */
    sshElevate: boolean().default(false).notNull(),
    /** TOFU pin, same contract as instances.sshHostFingerprint. */
    sshHostFingerprint: text(),

    // --- Reachability ---
    /** "connecting" | "reachable" | "unreachable" */
    status: text().default("connecting").notNull(),
    lastCheckedAt: timestamp({ mode: "date", withTimezone: false }),
    lastError: text(),

    // --- Platform identity (drives artifact selection + compatibility) ---
    /** /etc/os-release ID, e.g. "ubuntu" | "debian". */
    osId: text(),
    /** /etc/os-release VERSION_CODENAME, e.g. "noble". */
    osCodename: text(),
    /** uname -m, e.g. "x86_64". Anything else is refused. */
    arch: text(),

    // --- Measured hardware. Mirrors the instances.hw* block deliberately:
    // same probe, same parser, same semantics (specs are NOT cleared on a
    // failed probe, so last-known values stay visible).
    hwCpuCores: integer(),
    hwCpuLoad1: doublePrecision(),
    hwRamTotalMb: integer(),
    hwRamUsedMb: integer(),
    hwDiskTotalGb: integer(),
    hwDiskUsedGb: integer(),
    hwOsName: text(),
    hwOsVersion: text(),
    hwKernel: text(),
    hwUptimeSec: integer(),

    /**
     * How many agents this box is estimated to hold, from the measured specs
     * and the per-runtime footprints in src/configs/agent-footprint.ts.
     * Advisory — it drives the "fits ~N more" line, not a hard limit.
     */
    capacityAgents: integer().default(0).notNull(),

    // --- Connect-time prebake -------------------------------------------
    // Everything on a BYOS box that does NOT depend on which agent the
    // customer eventually picks is installed when they connect the server,
    // in the background, rather than inside the window they sit and watch
    // after clicking deploy. Same idea as the warm pool's bake-finalize
    // (see buildBakeFinalizeScript in warm-pool.ts), applied to a machine we
    // do not own.
    //
    // These columns exist because there is no Instance row at connect time,
    // so logSshStep / logInstanceEvent — which both key on instanceId — have
    // nowhere to write.
    /** "none" | "running" | "ready" | "failed" | "skipped" */
    prebakeStatus: text().default("none").notNull(),
    prebakeStartedAt: timestamp({ mode: "date", withTimezone: false }),
    prebakedAt: timestamp({ mode: "date", withTimezone: false }),
    prebakeError: text(),
    /**
     * The versions actually fetched onto the box. The deploy installs THESE,
     * not `latest` — re-resolving `latest` at deploy would miss the warm cache
     * and waste the entire prefetch. See src/lib/runtime-versions.ts.
     */
    prebakedOpenclawVersion: text(),
    prebakedHermesVersion: text(),
    prebakedWebuiVersion: text(),
    /**
     * When the operator accepted, on the connect form, that we preinstall
     * packages on this server. No consent, no prebake — the preflight is
     * otherwise strictly read-only and unprivileged, and this is the moment
     * that stops being true.
     */
    prebakeConsentAt: timestamp({ mode: "date", withTimezone: false }),

    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per (team, host, port) — reconnecting the same box updates it
    // rather than silently accumulating duplicates.
    uniqueIndex("ByosServer_teamId_host_port_key").on(t.teamId, t.host, t.port),
    index("ByosServer_teamId_idx").on(t.teamId),
    index("ByosServer_status_idx").on(t.status),
  ],
)

export const botHosts = pgTable(
  "BotHost",
  {
    id: cuid().primaryKey(),
    label: text().notNull(),
    vmId: text().notNull(),
    ipAddress: text().notNull(),
    region: text().notNull(),
    plan: text().notNull(),
    capacity: integer().default(15).notNull(),
    status: text().default("ready").notNull(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("BotHost_vmId_key").on(t.vmId),
    index("BotHost_status_idx").on(t.status),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// VPS Provider Router — multi-provider routing, budget, health
//
// `regions` / `serverConfigs` stay the normalized catalog (what the user
// picks). These tables map each normalized tier/region onto each provider's
// concrete codes, track an internal spend budget per provider, and log every
// routing decision + health probe. See src/lib/vps-router and
// src/lib/providers. The router never calls a provider balance API — budget
// (monthlyCreditsUsd, soft/hardLimitUsd, burnRate) is values WE configure.
// ──────────────────────────────────────────────────────────────────────

export const providers = pgTable(
  "Provider",
  {
    id: cuid().primaryKey(),
    // "linode" | "digitalocean"
    slug: text().notNull(),
    name: text().notNull(),
    // Hard gate — disabled providers are never routed to.
    enabled: boolean().default(true).notNull(),
    // Tie-breaker / admin preference nudge in scoring (higher = preferred).
    priority: integer().default(0).notNull(),
    // Admin override: when set, this provider is forced for the given region
    // (if it survives hard filters). NULL = no pin.
    pinnedRegionId: text().references((): AnyPgColumn => regions.id),
    // Which env var holds this provider's API token. Secrets stay in env,
    // never in the DB (mirrors the LINODE_API_TOKEN convention).
    credentialEnvKey: text(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("Provider_slug_key").on(t.slug)],
)

export const providerPlans = pgTable(
  "ProviderPlan",
  {
    id: cuid().primaryKey(),
    providerId: text()
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    // The normalized tier this maps to (shared-4g, dedicated-8g, …).
    serverConfigId: text()
      .notNull()
      .references(() => serverConfigs.id),
    // Provider's concrete plan code (g6-standard-2 / s-2vcpu-4gb / b2-7 …).
    providerPlanCode: text().notNull(),
    // Provider's monthly price (USD) — OUR cost; drives the cost-efficiency score.
    monthlyCostUsd: doublePrecision().notNull(),
    enabled: boolean().default(true).notNull(),
  },
  (t) => [
    uniqueIndex("ProviderPlan_provider_config_key").on(t.providerId, t.serverConfigId),
    index("ProviderPlan_serverConfigId_idx").on(t.serverConfigId),
  ],
)

export const providerRegions = pgTable(
  "ProviderRegion",
  {
    id: cuid().primaryKey(),
    providerId: text()
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    regionId: text()
      .notNull()
      .references(() => regions.id),
    // Provider's concrete region code (us-east / nyc3 / BHS …).
    providerRegionCode: text().notNull(),
    // Capacity / outage gate — false removes this provider from the region.
    available: boolean().default(true).notNull(),
  },
  (t) => [
    uniqueIndex("ProviderRegion_provider_region_key").on(t.providerId, t.regionId),
    index("ProviderRegion_regionId_idx").on(t.regionId),
  ],
)

export const providerBilling = pgTable(
  "ProviderBilling",
  {
    id: cuid().primaryKey(),
    providerId: text()
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    // Configured allowance for the current cycle (USD).
    monthlyCreditsUsd: doublePrecision().default(0).notNull(),
    // Accrued spend this cycle (USD) — incremented by daily-billing.
    currentUsageUsd: doublePrecision().default(0).notNull(),
    // Above soft → de-prioritized in scoring. At/above hard → rejected.
    softLimitUsd: doublePrecision(),
    hardLimitUsd: doublePrecision(),
    // Computed: currentUsageUsd / days elapsed in the cycle.
    burnRateUsdPerDay: doublePrecision().default(0).notNull(),
    cycleStart: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("ProviderBilling_providerId_key").on(t.providerId)],
)

export const routingLogs = pgTable(
  "RoutingLog",
  {
    id: cuid().primaryKey(),
    // NULL when routing happens before the instance row exists.
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    regionId: text(),
    serverConfigId: text(),
    workloadType: text(),
    // NULL = every candidate was rejected (no provider could serve the request).
    // On failover, this is the provider that ultimately SUCCEEDED (or the last
    // attempted, when all failed), so success rate is attributed correctly.
    chosenProviderId: text().references(() => providers.id, { onDelete: "set null" }),
    score: doublePrecision(),
    // Per-factor score breakdown of the winner: ScoreBreakdown shape.
    breakdown: jsonb(),
    // [{ providerId, reason }] for every candidate that was filtered out.
    rejected: jsonb(),
    // Provisioning outcome stamped by the provisioner: "succeeded" | "failed" |
    // "pending". Drives the per-provider success-rate score on future routes.
    outcome: text(),
    createdAt: now(),
  },
  (t) => [
    index("RoutingLog_instanceId_idx").on(t.instanceId),
    index("RoutingLog_createdAt_idx").on(t.createdAt),
  ],
)

export const providerHealthLogs = pgTable(
  "ProviderHealthLog",
  {
    id: cuid().primaryKey(),
    providerId: text()
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    // "up" | "degraded" | "down"
    status: text().notNull(),
    latencyMs: integer(),
    detail: jsonb(),
    checkedAt: now(),
  },
  (t) => [index("ProviderHealthLog_provider_checkedAt_idx").on(t.providerId, t.checkedAt)],
)

// ──────────────────────────────────────────────────────────────────────
// Warm VM pool — pre-booted, fully-bootstrapped VMs kept ready so a deploy
// can CLAIM one and skip the multi-minute cold install. Each row is a single
// generic VM (no per-instance secrets) identified by `poolKey`
// (provider|plan|region|runtime|webui). See src/lib/warm-pool.ts.
// ──────────────────────────────────────────────────────────────────────

export const warmVms = pgTable(
  "WarmVm",
  {
    id: cuid().primaryKey(),
    // Denormalized match key: `${providerSlug}|${planCode}|${regionCode}|${runtime}|${webui?1:0}`.
    poolKey: text().notNull(),
    // Owning provider row (nullable on the legacy/unseeded env-default path).
    providerId: text().references((): AnyPgColumn => providers.id),
    providerSlug: text().notNull(),
    providerPlanCode: text().notNull(),
    providerRegionCode: text().notNull(),
    // "openclaw" | "hermes".
    runtime: text().notNull(),
    webuiEnabled: boolean().default(false).notNull(),
    // Populated as the VM is created + booted.
    vmId: text(),
    ipAddress: text(),
    // Root password minted at create, encrypted at rest; copied onto the
    // instance row at claim.
    rootPasswordEnc: text(),
    // Host-key fingerprint captured once the box is reachable; copied onto the
    // instance at claim so TOFU pinning matches the already-known key.
    sshHostFingerprint: text(),
    // Generic public URL pre-assigned at promote-to-ready (Cloudflare subdomain →
    // this VM's IP), so a claim is an instant hand-off with the URL already
    // propagated. Copied onto the instance row at claim (the instance reuses this
    // hostname instead of minting its own). Deleted when the row is reaped.
    managedSubdomain: text(),
    cfRecordId: text(),
    // Lifecycle: creating → bootstrapping → ready → claimed. `failed` is a dead
    // row the reaper deletes + replaces.
    status: text().default("creating").notNull(),
    // Set when a deploy claims this VM (also stamps the instance row).
    claimedByInstanceId: text().references((): AnyPgColumn => instances.id, {
      onDelete: "set null",
    }),
    lastError: text(),
    createdAt: now(),
    readyAt: timestamp({ mode: "date", withTimezone: false }),
    claimedAt: timestamp({ mode: "date", withTimezone: false }),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("WarmVm_poolKey_status_idx").on(t.poolKey, t.status),
    index("WarmVm_status_idx").on(t.status),
    uniqueIndex("WarmVm_vmId_key").on(t.vmId),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Wallet (USD-denominated billing)
// ──────────────────────────────────────────────────────────────────────

// Wallet stores INTEGER credits (1 credit = $0.01 USD). The column is
// `doublePrecision` for legacy reasons but we only write whole numbers.
// See src/lib/credit-pricing.ts and src/lib/wallet.ts.
export const wallets = pgTable(
  "Wallet",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      // restrict, not cascade: users are closed, never hard-deleted
      // (src/lib/account-closure.ts), so the money and audit trail survives.
      .references(() => users.id, { onDelete: "restrict" }),
    balance: doublePrecision().default(0).notNull(),
    minimumBalance: doublePrecision().default(200).notNull(),
    // Cumulative credits ever funded into this wallet (topup + plan_deposit +
    // admin_grant + refund), NET of payment reversals — never decremented on
    // spend, only on a refund/dispute/void clawback (which un-funds). Drives
    // the OpenRouter per-key spend cap: cap = creditsToUsd(this) * margin.
    // See src/lib/credit-pricing.ts (keyLimitUsdFromCredits) and
    // src/lib/openrouter-billing.ts. Integer credits in a float column, same
    // legacy convention as `balance`.
    lifetimeFundedCredits: doublePrecision().default(0).notNull(),
    // Use-it-or-lose-it bucket: the unspent portion of the CURRENT period's
    // `plan_deposit`. A sub-portion of `balance` (persistent credits =
    // balance − planCredits). Deductions drain this first (see deductWithinTx),
    // a new plan deposit expires-then-replaces it, and an expiry sweep zeroes
    // it once `planCreditsExpireAt` passes (cancelled/lapsed subs). Purchased
    // top-ups / admin grants / refunds are NOT plan credits and never expire.
    // Integer credits in a float column, same legacy convention as `balance`.
    planCredits: doublePrecision().default(0).notNull(),
    // When the current plan bucket expires (= subscription.currentPeriodEnd at
    // deposit time). Null when there are no live plan credits.
    planCreditsExpireAt: timestamp({ mode: "date", withTimezone: false }),
    // Bigint migration — Commit 1 of 3 (additive). Backfill via
    // scripts/migrate-wallet-bigint.ts. Once dual-write is live and a few
    // days of drift checks come back clean, flip reads in Commit 3 and
    // drop the float columns. See plan-and-fix-these-hazy-riddle.md §3.1.
    balanceCents: bigint({ mode: "number" }),
    minimumBalanceCents: bigint({ mode: "number" }),
    // Cents shadow for planCredits (1 credit = 1 cent), same dual-write pattern.
    planCreditsCents: bigint({ mode: "number" }),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("Wallet_userId_key").on(t.userId),
    // Belt-and-suspenders: DB refuses negative balances even if a future code
    // path bypasses `deductFromWallet`. See src/lib/wallet.ts.
    check("Wallet_balance_nonneg", sql`${t.balance} >= 0`),
    // The plan bucket is a sub-portion of the balance and never negative.
    check("Wallet_planCredits_nonneg", sql`${t.planCredits} >= 0`),
  ],
)

export const walletTransactions = pgTable(
  "WalletTransaction",
  {
    id: cuid().primaryKey(),
    walletId: text()
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    amount: doublePrecision().notNull(),
    type: text().notNull(),
    description: text(),
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    balanceAfter: doublePrecision().notNull(),
    createdAt: now(),
  },
  (t) => [
    index("WalletTransaction_walletId_createdAt_idx").on(t.walletId, t.createdAt),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Idempotency — claim/release ledger for at-least-once event sources
// (Stripe webhooks, daily billing cron). See src/lib/idempotency.ts.
// ──────────────────────────────────────────────────────────────────────

export const processedEvents = pgTable(
  "ProcessedEvent",
  {
    source: text().notNull(),    // "stripe" | "daily_billing" | etc.
    eventId: text().notNull(),   // stripe event.id, or "YYYY-MM-DD" for cron
    processedAt: now(),
    payload: jsonb(),
  },
  (t) => [primaryKey({ columns: [t.source, t.eventId], name: "ProcessedEvent_pkey" })],
)

// ──────────────────────────────────────────────────────────────────────
// Rate limit buckets — Postgres-backed counters keyed by (key, windowStart).
// Replaces the in-memory Map in src/lib/rate-limit.ts which couldn't survive
// horizontal scaling. See src/lib/rate-limit.ts.
// ──────────────────────────────────────────────────────────────────────

export const rateLimitBuckets = pgTable(
  "RateLimitBucket",
  {
    key: text().notNull(),
    windowStart: timestamp({ mode: "date", withTimezone: false }).notNull(),
    count: integer().default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart], name: "RateLimitBucket_pkey" }),
    index("RateLimitBucket_windowStart_idx").on(t.windowStart),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Admin notifications
// ──────────────────────────────────────────────────────────────────────

export const adminNotifications = pgTable(
  "AdminNotification",
  {
    id: cuid().primaryKey(),
    type: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    message: text().notNull(),
    resolved: boolean().default(false).notNull(),
    resolvedAt: timestamp({ mode: "date", withTimezone: false }),
    resolvedBy: text(),
    meta: jsonb(),
    createdAt: now(),
  },
  (t) => [
    index("AdminNotification_type_resolved_idx").on(t.type, t.resolved),
    index("AdminNotification_userId_idx").on(t.userId),
  ],
)

// Account deletion requests — users submit, admins review & decide.
// Approval is notify-only: an admin then deletes the user via the Users page.
export const deletionRequests = pgTable(
  "DeletionRequest",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text(),
    status: text().default("pending").notNull(), // pending | approved | denied
    decidedBy: text(), // admin user id
    decidedAt: timestamp({ mode: "date", withTimezone: false }),
    decisionNote: text(), // admin note / denial reason shown to user
    createdAt: now(),
  },
  (t) => [
    index("DeletionRequest_status_idx").on(t.status),
    index("DeletionRequest_userId_idx").on(t.userId),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Usage / credits / logs / admin
// ──────────────────────────────────────────────────────────────────────

export const usageEvents = pgTable(
  "UsageEvent",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      // restrict, not cascade: users are closed, never hard-deleted
      // (src/lib/account-closure.ts), so the money and audit trail survives.
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text().notNull(),
    amount: integer().notNull(),
    meta: jsonb(),
    createdAt: now(),
  },
  (t) => [
    index("UsageEvent_instanceId_createdAt_idx").on(t.instanceId, t.createdAt),
    index("UsageEvent_userId_createdAt_idx").on(t.userId, t.createdAt),
  ],
)

export const creditLedger = pgTable(
  "CreditLedger",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      // restrict, not cascade: users are closed, never hard-deleted
      // (src/lib/account-closure.ts), so the money and audit trail survives.
      .references(() => users.id, { onDelete: "restrict" }),
    delta: integer().notNull(),
    reason: text().notNull(),
    balance: integer().notNull(),
    createdAt: now(),
  },
  (t) => [index("CreditLedger_userId_createdAt_idx").on(t.userId, t.createdAt)],
)

export const instanceLogs = pgTable(
  "InstanceLog",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    level: text().default("info").notNull(),
    message: text().notNull(),
    // Structured log fields — provisioner/reconciler/delete paths set these.
    // All optional so older log rows remain valid.
    stage: text(),
    action: text(),
    result: text(),
    durationMs: integer(),
    detail: jsonb(),
    createdAt: now(),
  },
  (t) => [index("InstanceLog_instanceId_idx").on(t.instanceId)],
)

// InstanceKnowledge — per-agent Knowledge Base sources (the `knowledge_base`
// tool; see src/configs/agent-tools.ts). Each row is one document or saved URL
// whose extracted text is shipped into the agent's `workspace/knowledge/`
// directory on provision/reprovision so the agent can consult and cite it. v1
// stores extracted plain text (not binaries) directly in Postgres — sources are
// small and the standalone deploy has no object store (same approach as
// teamBrandingAssets). See src/lib/provisioner.ts for the file sync.
export const instanceKnowledge = pgTable(
  "InstanceKnowledge",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    // "file" (uploaded document) | "url" (saved web page).
    type: text().notNull(),
    // Display name / filename (also the basename written into knowledge/).
    name: text().notNull(),
    // Extracted plain text the agent reads. Empty allowed (e.g. URL not yet fetched).
    textContent: text().default("").notNull(),
    // Original URL for type="url"; null for uploads.
    sourceUrl: text(),
    sizeBytes: integer(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index("InstanceKnowledge_instanceId_idx").on(t.instanceId)],
)

// AgentEvent — the high-volume agent runtime stream (runs, tool calls,
// messages, errors), distinct from InstanceLog (low-volume platform-side ops
// log). Written by the ingest endpoint (/api/instances/<id>/events) from
// agent-emitted batches. `teamId` is DENORMALIZED off the instance so a tenant
// can roll up cost/health/activity across every client agent in one indexed
// scan without joining. High churn — pruned on a retention cron. See the
// observability plan.
export const agentEvents = pgTable(
  "AgentEvent",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // run.started | run.finished | tool.called | message | error | heartbeat
    type: text().notNull(),
    // Agent-supplied wall-clock of the event; createdAt is our server receipt.
    occurredAt: timestamp({ mode: "date", withTimezone: false }),
    // Correlates events belonging to the same agent run/conversation.
    runId: text(),
    sessionId: text(),
    // LLM accounting (optional — only set on run/message events).
    model: text(),
    tokensIn: integer(),
    tokensOut: integer(),
    costUsd: doublePrecision(),
    latencyMs: integer(),
    // "ok" | "error" — set on run.finished / tool.called outcomes.
    status: text(),
    detail: jsonb(),
    createdAt: now(),
  },
  (t) => [
    index("AgentEvent_instanceId_createdAt_idx").on(t.instanceId, t.createdAt),
    index("AgentEvent_teamId_createdAt_idx").on(t.teamId, t.createdAt),
    index("AgentEvent_type_idx").on(t.type),
  ],
)

// InstanceUptimeSample — a rolling per-agent history of Uptime Kuma status
// readings, appended by the uptime-sync poller (one row per agent per run when a
// /metrics snapshot is present). This is what powers the Kuma-style heartbeat
// bars; the latest-snapshot columns on `instances` remain the source for the
// current badge. High churn, bounded by a retention prune inside runUptimeSync.
export const instanceUptimeSamples = pgTable(
  "InstanceUptimeSample",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    // "up" | "down" | "pending" | "maintenance" — null when Kuma reports none.
    status: text(),
    responseTimeMs: integer(),
    checkedAt: now(),
  },
  (t) => [index("InstanceUptimeSample_instanceId_checkedAt_idx").on(t.instanceId, t.checkedAt)],
)

// ServerMetricSample — a rolling per-server history of CPU load / RAM usage,
// appended by the metrics collector (one row per instance per successful probe).
// Powers the CPU/RAM sparkline on the instance detail page; the hw* columns on
// `instances` remain the source for the current values. Bounded by a retention
// prune inside collectServerMetrics (see src/lib/server-metrics.ts).
export const serverMetricSamples = pgTable(
  "ServerMetricSample",
  {
    id: cuid().primaryKey(),
    instanceId: text()
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    cpuLoad1: doublePrecision(),
    ramUsedMb: integer(),
    checkedAt: now(),
  },
  (t) => [index("ServerMetricSample_instanceId_checkedAt_idx").on(t.instanceId, t.checkedAt)],
)

// AlertRule — user-defined threshold on a monitoring metric. `instanceId` NULL
// means the rule applies to EVERY agent in the team (fleet-wide), which is how
// an agency arms one rule across all client agents. Evaluated by the
// alerts-eval cron, which fires through notify() and respects cooldownMinutes.
export const alertRules = pgTable(
  "AlertRule",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // NULL = all agents in the team. Otherwise scoped to one agent.
    instanceId: text().references(() => instances.id, { onDelete: "cascade" }),
    // down | latency_ms | uptime_ratio | cost_usd_period | error_rate
    metric: text().notNull(),
    comparator: text().notNull(), // "gt" | "lt"
    threshold: doublePrecision().notNull(),
    windowMinutes: integer().default(60).notNull(),
    cooldownMinutes: integer().default(60).notNull(),
    enabled: boolean().default(true).notNull(),
    lastFiredAt: timestamp({ mode: "date", withTimezone: false }),
    createdBy: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("AlertRule_teamId_idx").on(t.teamId),
    index("AlertRule_instanceId_idx").on(t.instanceId),
  ],
)

// OrphanEvent — one row per reconciler decision: "VM exists in provider but no
// DB row owns it" or "DB says deleting but provider still has it".
export const orphanEvents = pgTable(
  "OrphanEvent",
  {
    id: cuid().primaryKey(),
    vmId: text().notNull(),
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    action: text().notNull(), // detected | delete_attempted | deleted | failed
    // Public IP the VM held when we recorded/released it. Captured from the
    // provider VM (`vm.ipv4[0]`) in the reconciler orphan sweep, and from the
    // warm-pool row (`ipAddress`) when a warm VM is reaped — those rows have no
    // persistent Instance row to carry `deletedIpAddress`. NULL when unknown.
    ipAddress: text(),
    detectedAt: now(),
    resolvedAt: timestamp({ mode: "date", withTimezone: false }),
    detail: text(),
  },
  (t) => [
    index("OrphanEvent_vmId_idx").on(t.vmId),
    index("OrphanEvent_action_idx").on(t.action),
  ],
)

// DomainVerification — user claims a domain by publishing a TXT record with
// a nonce BEFORE we provision a VM. Deploy route checks this table.
export const domainVerifications = pgTable(
  "DomainVerification",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text().notNull(),
    nonce: text().notNull(),
    verifiedAt: timestamp({ mode: "date", withTimezone: false }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("DomainVerification_userId_domain_key").on(t.userId, t.domain),
    index("DomainVerification_domain_idx").on(t.domain),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Teams / memberships / invites
// ──────────────────────────────────────────────────────────────────────

export const teams = pgTable(
  "Team",
  {
    id: cuid().primaryKey(),
    name: text().notNull(),
    ownerId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Member cap. NULL = derive the effective cap from the owner's plan tier at
    // runtime (see getTeamSeatLimit in src/lib/seats.ts). Non-null = an explicit
    // override that wins over the plan: a platform-admin support cap, or a reseller
    // tenant's child cap set from `defaultChildSeatLimit`.
    seatLimit: integer(),
    // Reseller hierarchy. NULL = a top-level team (today's behavior, incl. every
    // existing team after backfill). Non-null = a child end-customer account
    // that signed up under a white-label tenant; points at the PARENT tenant's
    // team. `onDelete: set null` so deleting a tenant orphans (not deletes) its
    // customers. See src/lib/tenant.ts for the hierarchy helpers.
    parentTeamId: text().references((): AnyPgColumn => teams.id, {
      onDelete: "set null",
    }),
    // Set by a tenant admin to suspend one of their end-customers — blocks new
    // agent deploys for that child team (enforced in src/lib/tenant.ts
    // requireActiveTeam). NULL = active.
    suspendedAt: timestamp({ mode: "date", withTimezone: false }),
    // Per-customer cap on live agents (tenant-controlled). NULL = inherit the
    // tenant default / no cap. `seatLimit` already caps members.
    agentLimit: integer(),
    // Platform-admin white-label switch. SOLE source of truth for white-label
    // entitlement (custom branding, custom domains, reseller panel) — see
    // teamHasWhiteLabel in src/lib/white-label.ts. Default false; a platform
    // admin flips it from /admin/teams. Subscription tier does NOT auto-grant.
    whiteLabelEnabled: boolean().default(false).notNull(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("Team_ownerId_idx").on(t.ownerId),
    index("Team_parentTeamId_idx").on(t.parentTeamId),
  ],
)

// Reseller/tenant-level config. Sparse — one row per PARENT tenant team that
// has turned on reseller features. Holds settings that don't belong on every
// team row: bring-your-own Chatwoot (Phase 4), Stripe Connect (Phase 6), the
// tenant's own OpenRouter provisioning key (Phase 6), and default limits
// applied to newly self-created child accounts. Secrets are encrypted at rest
// (see src/lib/crypto-secret.ts), same pattern as cloudflareConnections.
export const tenantConfig = pgTable(
  "TenantConfig",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // Defaults stamped onto child teams created via self-serve signup.
    defaultChildAgentLimit: integer(),
    defaultChildSeatLimit: integer(),
    // Bring-your-own Chatwoot (Phase 4). The tenant's end-customers' support
    // tickets route to THIS Chatwoot instead of the platform's. Secrets are
    // encrypted (crypto-secret.ts); baseUrl/account/inbox + the public website
    // token (drives the widget) are stored plainly. All-null = fall back to the
    // platform Chatwoot env config. See src/lib/chatwoot.ts.
    chatwootBaseUrl: text(),
    chatwootApiTokenEnc: text(),
    chatwootAccountId: text(),
    chatwootInboxId: text(),
    chatwootWebsiteToken: text(),
    chatwootHmacTokenEnc: text(),
    // Stripe Connect (Phase 6). The tenant's end-customers pay the tenant's OWN
    // connected account (Standard, no platform application fee); we only charge
    // the tenant the enterprise fee on the platform Stripe. charges/payouts
    // flags mirror the connected account so checkout can be blocked until ready.
    stripeConnectAccountId: text(),
    stripeConnectChargesEnabled: boolean().default(false).notNull(),
    stripeConnectPayoutsEnabled: boolean().default(false).notNull(),
    // The tenant's OWN OpenRouter provisioning key (encrypted). Child-org agent
    // runtime keys are minted against THIS, not the platform key, so the tenant
    // bears their customers' LLM cost. See getOrMintInstanceOpenRouterKey.
    openRouterProvisioningKeyEnc: text(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("TenantConfig_teamId_key").on(t.teamId)],
)

// A reseller tenant's plan catalog. Each row is a Stripe Price the tenant
// created ON THEIR OWN connected account (see stripe-connect.ts). A child
// end-customer subscribes to one of these via Connect checkout; on activation
// the linked entitlement (agentLimit/seatLimit) is stamped onto the child team.
// `teamId` is the TENANT team (owner of the catalog), not a child.
export const tenantPlans = pgTable(
  "TenantPlan",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    stripePriceId: text().notNull(),
    name: text().notNull(),
    // Entitlement granted to the child team while this plan is active.
    agentLimit: integer(),
    seatLimit: integer(),
    // Display metadata (billing happens on the tenant's Stripe; these are for UI).
    priceCents: integer(),
    interval: text().default("month").notNull(), // "month" | "year"
    active: boolean().default(true).notNull(),
    createdAt: now(),
  },
  (t) => [index("TenantPlan_teamId_idx").on(t.teamId)],
)

// Roles: owner | admin | developer | viewer
export const memberships = pgTable(
  "Membership",
  {
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().default("developer").notNull(),
    createdAt: now(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId], name: "Membership_pkey" }),
    index("Membership_userId_idx").on(t.userId),
  ],
)

export const teamInvites = pgTable(
  "TeamInvite",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().default("developer").notNull(),
    token: text().notNull(),
    invitedById: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ mode: "date", withTimezone: false }).notNull(),
    acceptedAt: timestamp({ mode: "date", withTimezone: false }),
    revokedAt: timestamp({ mode: "date", withTimezone: false }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("TeamInvite_token_key").on(t.token),
    index("TeamInvite_teamId_idx").on(t.teamId),
    index("TeamInvite_email_idx").on(t.email),
  ],
)

// Per-team white-label config. One row per team (1:1). Sparse — only teams
// that turn on white-label ever get a row. Gating on an active scale/enterprise
// subscription is enforced at read/write time (see src/lib/white-label.ts), so
// a downgrade reverts the look without deleting this config. Colors are raw CSS
// color strings, validated on write AND before being emitted into a <style>
// tag (CSS-injection guard). The custom dashboard domain is served via
// Cloudflare for SaaS Custom Hostnames (see src/lib/cloudflare-saas.ts) — only
// a row whose `domainVerifiedAt` is set ever resolves.
export const teamBranding = pgTable(
  "TeamBranding",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // Identity — null falls back to the default BRANDING constant.
    brandName: text(),
    logoUrl: text(), // expanded sidebar logo
    logoMarkUrl: text(), // collapsed "S" mark
    faviconUrl: text(),
    supportEmail: text(),
    // Theme — light + dark variants of the two team-controllable accents.
    primaryLight: text(),
    accentLight: text(),
    primaryDark: text(),
    accentDark: text(),
    // Custom dashboard domain (e.g. app.agency.com). Globally unique.
    customDomain: text(),
    domainVerifiedAt: timestamp({ mode: "date", withTimezone: false }),
    dnsStatus: text(), // null | "pending" | "ready"  (mirrors Instance)
    tlsStatus: text(), // null | "pending" | "issued"
    // Cloudflare for SaaS custom-hostname id, for status polling + teardown.
    // Set when the domain is attached; cleared on detach. See cloudflare-saas.ts.
    cfCustomHostnameId: text(),
    // Team-level on/off, independent of the entitlement gate.
    brandingEnabled: boolean().default(true).notNull(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("TeamBranding_teamId_key").on(t.teamId),
    // PG treats NULLs as distinct, so many teams without a custom domain
    // coexist; the index enforces uniqueness only across non-null values.
    uniqueIndex("TeamBranding_customDomain_key").on(t.customDomain),
    index("TeamBranding_customDomain_idx").on(t.customDomain),
  ],
)

// Uploaded white-label image assets, stored in Postgres (the standalone deploy
// has no object store). One row per (team, kind). Bytes are base64-encoded text
// — assets are small (capped at a few hundred KB). Served publicly, sandboxed,
// via /api/branding-asset/[teamId]/[kind]; the matching teamBranding URL field
// points at that route with a cache-busting ?v param.
export const teamBrandingAssets = pgTable(
  "TeamBrandingAsset",
  {
    id: cuid().primaryKey(),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    kind: text().notNull(), // "logo" | "logoMark" | "favicon"
    contentType: text().notNull(),
    dataBase64: text().notNull(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("TeamBrandingAsset_teamId_kind_key").on(t.teamId, t.kind)],
)

export const adminNotes = pgTable(
  "AdminNote",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: text().notNull(),
    content: text().notNull(),
    createdAt: now(),
  },
  (t) => [index("AdminNote_userId_idx").on(t.userId)],
)

// ──────────────────────────────────────────────────────────────────────
// Audit log
// ──────────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  "AuditLog",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      // restrict, not cascade: users are closed, never hard-deleted
      // (src/lib/account-closure.ts), so the money and audit trail survives.
      .references(() => users.id, { onDelete: "restrict" }),
    teamId: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    targetLabel: text(),
    ipAddress: text(),
    userAgent: text(),
    meta: jsonb(),
    createdAt: now(),
  },
  (t) => [
    index("AuditLog_userId_createdAt_idx").on(t.userId, t.createdAt),
    index("AuditLog_teamId_idx").on(t.teamId),
    index("AuditLog_action_idx").on(t.action),
  ],
)

// Support tickets — mirrored locally so users get an in-dashboard history.
// Source of truth for live conversation lives in Chatwoot; the chatwoot*
// columns link a ticket back to its Chatwoot contact/conversation.
export const supportTickets = pgTable(
  "SupportTicket",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    message: text().notNull(),
    category: text().default("general").notNull(), // general | billing | technical | account
    priority: text().default("normal").notNull(), // low | normal | high | urgent
    status: text().default("open").notNull(), // open | in_progress | pending | resolved
    chatwootConversationId: integer(),
    chatwootContactId: integer(),
    // Which Chatwoot the conversation lives in: the tenant team whose BYO
    // Chatwoot was used, or NULL for the platform Chatwoot. Lets reply/status
    // routes resolve the SAME config that created the conversation, even if the
    // user later switches active team. See src/lib/chatwoot.ts.
    chatwootTenantTeamId: text(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("SupportTicket_userId_createdAt_idx").on(t.userId, t.createdAt)],
)

// ──────────────────────────────────────────────────────────────────────
// Notifications (user-facing, multi-channel)
// ──────────────────────────────────────────────────────────────────────

// One row per delivered in-app notification (the dashboard bell + feed).
export const notifications = pgTable(
  "Notification",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text().notNull(), // billing | provisioning | security
    type: text().notNull(), // provision_complete | low_balance | ...
    title: text().notNull(),
    message: text().notNull(),
    url: text(), // optional in-app deep link, e.g. /dashboard/instances/<id>
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    meta: jsonb(),
    readAt: timestamp({ mode: "date", withTimezone: false }),
    createdAt: now(),
  },
  (t) => [
    index("Notification_userId_readAt_idx").on(t.userId, t.readAt),
    index("Notification_userId_createdAt_idx").on(t.userId, t.createdAt),
  ],
)

// One row per user: the per-category × per-channel preference matrix plus the
// contact identities for each external channel.
export const notificationPreferences = pgTable(
  "NotificationPreference",
  {
    id: cuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // { [category]: { inApp, email, telegram, discord, slack: boolean } }
    matrix: jsonb().$type<Record<string, Record<string, boolean>>>(),
    telegramChatId: text(), // captured by the deep-link connect flow
    telegramLinkToken: text(), // pending connect token, cleared once linked
    discordWebhookUrl: text(),
    slackWebhookUrl: text(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("NotificationPreference_userId_key").on(t.userId),
    uniqueIndex("NotificationPreference_telegramLinkToken_key").on(t.telegramLinkToken),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Google Drive backup integration
// ──────────────────────────────────────────────────────────────────────

// One per user: the OAuth link to the user's own Google Drive. We request
// the `drive.file` scope with access_type=offline and store ONLY the refresh
// token (encrypted with INSTANCE_ENCRYPTION_KEY via encryptSecret). Access
// tokens are minted on demand and never persisted. This is intentionally
// separate from the Auth.js `accounts` row (which has login scopes only and
// no usable Drive/refresh token) — see src/lib/google-drive.ts.
export const driveConnections = pgTable(
  "DriveConnection",
  {
    id: cuid().primaryKey(),
    // One Drive connection per team (shared). `userId` records who connected it.
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleEmail: text(), // for "Connected as …" display
    refreshTokenEnc: text().notNull(), // encryptSecret() output (AES-256-GCM)
    scope: text(),
    connectedAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("DriveConnection_teamId_key").on(t.teamId)],
)

// Bring-Your-Own-Cloudflare. One per user. We store ONLY a scoped Cloudflare
// API token (encrypted with INSTANCE_ENCRYPTION_KEY via encryptSecret) that the
// user pastes — it must carry Zone:Read + Zone:DNS:Edit (+ Zone Settings:Edit
// to set the SSL mode). Lets agencies/whitelabel customers put agents on
// subdomains of their own zones. See src/lib/cloudflare.ts.
export const cloudflareConnections = pgTable(
  "CloudflareConnection",
  {
    id: cuid().primaryKey(),
    // One Cloudflare connection per team (shared). `userId` records who connected it.
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    apiTokenEnc: text().notNull(), // encryptSecret() output (AES-256-GCM)
    accountName: text(), // for "Connected as …" display
    email: text(),
    connectedAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("CloudflareConnection_teamId_key").on(t.teamId)],
)

// Local index of agent backups that live in the user's Drive. The backup
// CONTENT is the JSON file in Drive; this row powers fast list rendering and
// Postgres-side ownership checks without round-tripping Drive on every load.
export const backupRecords = pgTable(
  "BackupRecord",
  {
    id: cuid().primaryKey(),
    // Team that owns the backup (= source instance's team). `userId` records
    // who triggered it.
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // set null (not cascade): a backup stays listable after its source agent
    // is deleted, so the user can still restore-as-new from it.
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    driveFileId: text().notNull(),
    fileName: text().notNull(),
    agentName: text().notNull(), // snapshot of the agent name at backup time
    schemaVersion: integer().default(1).notNull(),
    sizeBytes: integer(),
    createdAt: now(),
  },
  (t) => [
    index("BackupRecord_teamId_idx").on(t.teamId),
    index("BackupRecord_userId_idx").on(t.userId),
    index("BackupRecord_instanceId_idx").on(t.instanceId),
    uniqueIndex("BackupRecord_driveFileId_key").on(t.driveFileId),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Admin: platform database backups → Cloudflare R2
// ──────────────────────────────────────────────────────────────────────

// Singleton platform config holding the Cloudflare R2 credentials used for
// admin database backups. Exactly one row is expected; the app always reads
// and updates the first row. Secrets are encryptSecret() output (AES-256-GCM).
export const r2BackupConfig = pgTable("R2BackupConfig", {
  id: cuid().primaryKey(),
  accountId: text().notNull(), // Cloudflare account id (plaintext)
  bucket: text().notNull(), // R2 bucket name (plaintext)
  // Optional custom S3 endpoint. Defaults to
  // https://<accountId>.r2.cloudflarestorage.com when null.
  endpoint: text(),
  accessKeyIdEnc: text().notNull(), // encryptSecret() output
  secretAccessKeyEnc: text().notNull(), // encryptSecret() output
  // How many of the newest backups to keep; older ones are pruned after a
  // successful backup.
  retentionCount: integer().default(14).notNull(),
  updatedByUserId: text(), // who last saved the config
  updatedAt: timestamp({ mode: "date", withTimezone: false })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

// One row per database backup run. The backup CONTENT is the pg_dump object in
// R2 (`objectKey`); this row powers the admin list, status/error surfacing, and
// retention without round-tripping R2 on every load.
export const databaseBackups = pgTable(
  "DatabaseBackup",
  {
    id: cuid().primaryKey(),
    objectKey: text().notNull(), // R2 object key
    fileName: text().notNull(), // human-readable name
    sizeBytes: bigint({ mode: "number" }), // dump size; null until upload finishes
    status: text().notNull(), // "pending" | "success" | "failed"
    error: text(), // failure detail (pg_dump/upload stderr), null on success
    trigger: text().notNull(), // "manual" | "scheduled"
    createdByUserId: text(), // who triggered it; null for cron
    startedAt: now(),
    completedAt: timestamp({ mode: "date", withTimezone: false }),
  },
  (t) => [
    index("DatabaseBackup_startedAt_idx").on(t.startedAt),
    uniqueIndex("DatabaseBackup_objectKey_key").on(t.objectKey),
  ],
)

// ──────────────────────────────────────────────────────────────────────
// Relations (enables db.query.<table>.findMany({ with: { ... } }))
// ──────────────────────────────────────────────────────────────────────

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  subscriptions: many(subscriptions),
  instances: many(instances),
  sshKeys: many(sshKeys),
  adminNotes: many(adminNotes, { relationName: "userNotes" }),
  usageEvents: many(usageEvents),
  creditLedger: many(creditLedger),
  ownedTeams: many(teams),
  memberships: many(memberships),
  auditLogs: many(auditLogs),
  supportTickets: many(supportTickets),
  wallet: one(wallets),
  notifications: many(notifications),
  notificationPreference: one(notificationPreferences),
  driveConnections: many(driveConnections),
  cloudflareConnections: many(cloudflareConnections),
  backups: many(backupRecords),
}))

export const cloudflareConnectionsRelations = relations(
  cloudflareConnections,
  ({ one }) => ({
    team: one(teams, {
      fields: [cloudflareConnections.teamId],
      references: [teams.id],
    }),
    user: one(users, {
      fields: [cloudflareConnections.userId],
      references: [users.id],
    }),
  }),
)

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  instance: one(instances, {
    fields: [notifications.instanceId],
    references: [instances.id],
  }),
}))

export const notificationPreferencesRelations = relations(
  notificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationPreferences.userId],
      references: [users.id],
    }),
  }),
)

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, { fields: [teams.ownerId], references: [users.id] }),
  memberships: many(memberships),
  invites: many(teamInvites),
  branding: one(teamBranding),
  instances: many(instances),
  sshKeys: many(sshKeys),
  driveConnection: one(driveConnections),
  cloudflareConnection: one(cloudflareConnections),
  backups: many(backupRecords),
  // Reseller hierarchy (self-relation; relationName disambiguates the two ends).
  parent: one(teams, {
    fields: [teams.parentTeamId],
    references: [teams.id],
    relationName: "teamHierarchy",
  }),
  children: many(teams, { relationName: "teamHierarchy" }),
  tenantConfig: one(tenantConfig),
}))

export const tenantConfigRelations = relations(tenantConfig, ({ one }) => ({
  team: one(teams, { fields: [tenantConfig.teamId], references: [teams.id] }),
}))

export const teamBrandingRelations = relations(teamBranding, ({ one }) => ({
  team: one(teams, { fields: [teamBranding.teamId], references: [teams.id] }),
}))

export const teamBrandingAssetsRelations = relations(teamBrandingAssets, ({ one }) => ({
  team: one(teams, { fields: [teamBrandingAssets.teamId], references: [teams.id] }),
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  team: one(teams, { fields: [memberships.teamId], references: [teams.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}))

export const teamInvitesRelations = relations(teamInvites, ({ one }) => ({
  team: one(teams, { fields: [teamInvites.teamId], references: [teams.id] }),
  invitedBy: one(users, { fields: [teamInvites.invitedById], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  instance: one(instances, {
    fields: [subscriptions.instanceId],
    references: [instances.id],
  }),
  byosServer: one(byosServers, {
    fields: [subscriptions.byosServerId],
    references: [byosServers.id],
  }),
}))

export const regionsRelations = relations(regions, ({ many }) => ({
  instances: many(instances),
}))

export const serverConfigsRelations = relations(serverConfigs, ({ many }) => ({
  instances: many(instances),
}))

export const sshKeysRelations = relations(sshKeys, ({ one, many }) => ({
  team: one(teams, { fields: [sshKeys.teamId], references: [teams.id] }),
  user: one(users, { fields: [sshKeys.userId], references: [users.id] }),
  instances: many(instances),
}))

export const instancesRelations = relations(instances, ({ one, many }) => ({
  user: one(users, { fields: [instances.userId], references: [users.id] }),
  team: one(teams, { fields: [instances.teamId], references: [teams.id] }),
  accessGrants: many(instanceAccess),
  region: one(regions, { fields: [instances.regionId], references: [regions.id] }),
  serverConfig: one(serverConfigs, {
    fields: [instances.serverConfigId],
    references: [serverConfigs.id],
  }),
  sshKey: one(sshKeys, { fields: [instances.sshKeyId], references: [sshKeys.id] }),
  botHost: one(botHosts, {
    fields: [instances.botHostId],
    references: [botHosts.id],
  }),
  byosServer: one(byosServers, {
    fields: [instances.byosServerId],
    references: [byosServers.id],
  }),
  provider: one(providers, {
    fields: [instances.providerId],
    references: [providers.id],
  }),
  logs: many(instanceLogs),
  subscription: one(subscriptions),
  usageEvents: many(usageEvents),
  backups: many(backupRecords),
}))

export const botHostsRelations = relations(botHosts, ({ many }) => ({
  instances: many(instances),
}))

export const byosServersRelations = relations(byosServers, ({ one, many }) => ({
  team: one(teams, { fields: [byosServers.teamId], references: [teams.id] }),
  user: one(users, { fields: [byosServers.userId], references: [users.id] }),
  // Designed as many from day one: one server is meant to hold several agents.
  // Not capped anywhere — neither here nor at the install endpoint. See the
  // ByosServer block above.
  instances: many(instances),
}))

export const providersRelations = relations(providers, ({ one, many }) => ({
  pinnedRegion: one(regions, {
    fields: [providers.pinnedRegionId],
    references: [regions.id],
  }),
  plans: many(providerPlans),
  regions: many(providerRegions),
  billing: one(providerBilling),
  healthLogs: many(providerHealthLogs),
  instances: many(instances),
}))

export const providerPlansRelations = relations(providerPlans, ({ one }) => ({
  provider: one(providers, {
    fields: [providerPlans.providerId],
    references: [providers.id],
  }),
  serverConfig: one(serverConfigs, {
    fields: [providerPlans.serverConfigId],
    references: [serverConfigs.id],
  }),
}))

export const providerRegionsRelations = relations(providerRegions, ({ one }) => ({
  provider: one(providers, {
    fields: [providerRegions.providerId],
    references: [providers.id],
  }),
  region: one(regions, {
    fields: [providerRegions.regionId],
    references: [regions.id],
  }),
}))

export const providerBillingRelations = relations(providerBilling, ({ one }) => ({
  provider: one(providers, {
    fields: [providerBilling.providerId],
    references: [providers.id],
  }),
}))

export const providerHealthLogsRelations = relations(providerHealthLogs, ({ one }) => ({
  provider: one(providers, {
    fields: [providerHealthLogs.providerId],
    references: [providers.id],
  }),
}))

export const routingLogsRelations = relations(routingLogs, ({ one }) => ({
  instance: one(instances, {
    fields: [routingLogs.instanceId],
    references: [instances.id],
  }),
  chosenProvider: one(providers, {
    fields: [routingLogs.chosenProviderId],
    references: [providers.id],
  }),
}))

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  instance: one(instances, {
    fields: [usageEvents.instanceId],
    references: [instances.id],
  }),
  user: one(users, { fields: [usageEvents.userId], references: [users.id] }),
}))

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  user: one(users, { fields: [creditLedger.userId], references: [users.id] }),
}))

export const instanceLogsRelations = relations(instanceLogs, ({ one }) => ({
  instance: one(instances, {
    fields: [instanceLogs.instanceId],
    references: [instances.id],
  }),
}))

export const adminNotesRelations = relations(adminNotes, ({ one }) => ({
  user: one(users, {
    fields: [adminNotes.userId],
    references: [users.id],
    relationName: "userNotes",
  }),
}))

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
  transactions: many(walletTransactions),
}))

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  wallet: one(wallets, {
    fields: [walletTransactions.walletId],
    references: [wallets.id],
  }),
  instance: one(instances, {
    fields: [walletTransactions.instanceId],
    references: [instances.id],
  }),
}))

export const adminNotificationsRelations = relations(adminNotifications, ({ one }) => ({
  user: one(users, {
    fields: [adminNotifications.userId],
    references: [users.id],
  }),
  instance: one(instances, {
    fields: [adminNotifications.instanceId],
    references: [instances.id],
  }),
}))

export const deletionRequestsRelations = relations(deletionRequests, ({ one }) => ({
  user: one(users, {
    fields: [deletionRequests.userId],
    references: [users.id],
  }),
}))

export const driveConnectionsRelations = relations(driveConnections, ({ one }) => ({
  team: one(teams, { fields: [driveConnections.teamId], references: [teams.id] }),
  user: one(users, { fields: [driveConnections.userId], references: [users.id] }),
}))

export const backupRecordsRelations = relations(backupRecords, ({ one }) => ({
  team: one(teams, { fields: [backupRecords.teamId], references: [teams.id] }),
  user: one(users, { fields: [backupRecords.userId], references: [users.id] }),
  instance: one(instances, {
    fields: [backupRecords.instanceId],
    references: [instances.id],
  }),
}))

export const instanceAccessRelations = relations(instanceAccess, ({ one }) => ({
  instance: one(instances, {
    fields: [instanceAccess.instanceId],
    references: [instances.id],
  }),
  user: one(users, {
    fields: [instanceAccess.userId],
    references: [users.id],
    relationName: "accessGrantee",
  }),
  grantedBy: one(users, {
    fields: [instanceAccess.grantedById],
    references: [users.id],
    relationName: "accessGrantor",
  }),
}))

// AllowedModel — admin-managed mirror of the OpenRouter ACCOUNT model
// allowlist. Per-instance runtime keys are minted under the platform account,
// so bots can only reach models enabled there; this table is what the admin
// dashboard edits when that account allowlist changes (the code constant
// ALLOWED_OPENROUTER_MODELS only seeds the first run). `enabled=false` keeps
// the row (and its metadata) while hiding the model from agent selection.
export const allowedModels = pgTable("AllowedModel", {
  // OpenRouter slug, e.g. "minimax/minimax-m2.5" or "google/gemma-4-31b-it:free".
  slug: text().primaryKey(),
  label: text().notNull(),
  // chat | image | moderation — only chat models are usable as agent brains.
  kind: text().default("chat").notNull(),
  // Max context window (tokens), synced from the OpenRouter catalog. Gates
  // Hermes-compatibility: Hermes crash-loops on <64k models, so the per-instance
  // picker only offers chat models with contextLength >= 64000. NULL = unknown
  // (not yet synced) → excluded from the Hermes list. See syncModelMetadata().
  contextLength: integer(),
  enabled: boolean().default(true).notNull(),
  createdAt: now(),
  updatedAt: timestamp({ mode: "date", withTimezone: false })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

// Re-export sql for convenience in call sites.
export { sql }
