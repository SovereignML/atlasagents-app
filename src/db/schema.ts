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
    activeTeamId: text(),
    // Two-factor authentication (TOTP, RFC 6238).
    //   `twoFactorSecret`       — base32 secret, encrypted at rest with INSTANCE_ENCRYPTION_KEY.
    //   `twoFactorEnabled`      — flips to true only after the user verifies a code post-enroll.
    //   `twoFactorBackupCodes`  — bcrypt hashes of one-time backup codes; consumed on use.
    twoFactorSecret: text(),
    twoFactorEnabled: boolean().default(false).notNull(),
    twoFactorBackupCodes: jsonb().$type<string[]>(),
    twoFactorEnrolledAt: timestamp({ mode: "date", withTimezone: false }),
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
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text()
      .notNull()
      .references(() => plans.id),
    instanceId: text().references(() => instances.id),
    stripeSubscriptionId: text(),
    stripePriceId: text(),
    interval: text().default("month").notNull(),
    status: text().default("incomplete").notNull(),
    currentPeriodEnd: timestamp({ mode: "date", withTimezone: false }),
    cancelAtPeriodEnd: boolean().default(false).notNull(),
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
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    publicKey: text().notNull(),
    fingerprint: text().notNull(),
    createdAt: now(),
  },
  (t) => [index("SshKey_userId_idx").on(t.userId)],
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
    modelTier: text(),
    botToken: text(),
    // SSH host key fingerprint pinned on first successful connect (TOFU).
    // Format: "sha256:<base64>". Subsequent SSH calls verify against this;
    // mismatch = abort. See src/lib/ssh.ts connectAndPin().
    sshHostFingerprint: text(),
    lastActiveAt: timestamp({ mode: "date", withTimezone: false }),
    /** Set when status becomes `deleted` — used for admin audit / sorting */
    deletedAt: timestamp({ mode: "date", withTimezone: false }),
    deploymentTarget: text(),
    // Agent runtime engine for the VPS path: "openclaw" (default) | "hermes".
    // NULL on pre-existing rows; getRuntime() coerces NULL -> "openclaw".
    runtime: text().default("openclaw"),
    // Hermes-only: provision Open WebUI as a Docker sidecar fronting the gateway
    // so the user gets a web chat UI. For Hermes+webui the dormant
    // openclawAdmin* columns below hold the Open WebUI admin login.
    webuiEnabled: boolean().default(false).notNull(),
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

    // Bring Your Own Server (BYOS) — populated only when
    // deploymentTarget = "byos". The user runs their own server and pastes
    // our SSH_FLEET_PUBLIC_KEY into its root authorized_keys; we connect with
    // the fleet private key (same path as the Linode VPS flow, minus VM
    // creation). No user SSH secret is stored.
    byosHost: text(),
    byosPort: integer().default(22),
    byosUser: text().default("root"),
    // "managed_credits" (user buys OpenRouter credits from us — we mint a
    // per-instance key as usual) | "own_key" (user brings their own LLM API
    // key, stored encrypted in byosOwnApiKeyEnc and injected instead of
    // minting).
    byosLlmMode: text(),
    byosOwnApiKeyEnc: text(),

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
    index("Instance_status_idx").on(t.status),
    index("Instance_botHostId_idx").on(t.botHostId),
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
    // "linode" | "digitalocean" | "ovh"
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
      .references(() => users.id, { onDelete: "cascade" }),
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
    // Bigint migration — Commit 1 of 3 (additive). Backfill via
    // scripts/migrate-wallet-bigint.ts. Once dual-write is live and a few
    // days of drift checks come back clean, flip reads in Commit 3 and
    // drop the float columns. See plan-and-fix-these-hazy-riddle.md §3.1.
    balanceCents: bigint({ mode: "number" }),
    minimumBalanceCents: bigint({ mode: "number" }),
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
      .references(() => users.id, { onDelete: "cascade" }),
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
      .references(() => users.id, { onDelete: "cascade" }),
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

// OrphanEvent — one row per reconciler decision: "VM exists in provider but no
// DB row owns it" or "DB says deleting but provider still has it".
export const orphanEvents = pgTable(
  "OrphanEvent",
  {
    id: cuid().primaryKey(),
    vmId: text().notNull(),
    instanceId: text().references(() => instances.id, { onDelete: "set null" }),
    action: text().notNull(), // detected | delete_attempted | deleted | failed
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
    seatLimit: integer().default(5).notNull(),
    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("Team_ownerId_idx").on(t.ownerId)],
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
// tag (CSS-injection guard). The custom dashboard domain is served via Caddy
// on-demand TLS — only a row whose `domainVerifiedAt` is set ever resolves.
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
      .references(() => users.id, { onDelete: "cascade" }),
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
    status: text().default("open").notNull(), // open | pending | resolved
    chatwootConversationId: integer(),
    chatwootContactId: integer(),
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
  (t) => [uniqueIndex("DriveConnection_userId_key").on(t.userId)],
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
  (t) => [uniqueIndex("CloudflareConnection_userId_key").on(t.userId)],
)

// Local index of agent backups that live in the user's Drive. The backup
// CONTENT is the JSON file in Drive; this row powers fast list rendering and
// Postgres-side ownership checks without round-tripping Drive on every load.
export const backupRecords = pgTable(
  "BackupRecord",
  {
    id: cuid().primaryKey(),
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
    index("BackupRecord_userId_idx").on(t.userId),
    index("BackupRecord_instanceId_idx").on(t.instanceId),
    uniqueIndex("BackupRecord_driveFileId_key").on(t.driveFileId),
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
  driveConnection: one(driveConnections),
  cloudflareConnection: one(cloudflareConnections),
  backups: many(backupRecords),
}))

export const cloudflareConnectionsRelations = relations(
  cloudflareConnections,
  ({ one }) => ({
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
}))

export const regionsRelations = relations(regions, ({ many }) => ({
  instances: many(instances),
}))

export const serverConfigsRelations = relations(serverConfigs, ({ many }) => ({
  instances: many(instances),
}))

export const sshKeysRelations = relations(sshKeys, ({ one, many }) => ({
  user: one(users, { fields: [sshKeys.userId], references: [users.id] }),
  instances: many(instances),
}))

export const instancesRelations = relations(instances, ({ one, many }) => ({
  user: one(users, { fields: [instances.userId], references: [users.id] }),
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

export const driveConnectionsRelations = relations(driveConnections, ({ one }) => ({
  user: one(users, { fields: [driveConnections.userId], references: [users.id] }),
}))

export const backupRecordsRelations = relations(backupRecords, ({ one }) => ({
  user: one(users, { fields: [backupRecords.userId], references: [users.id] }),
  instance: one(instances, {
    fields: [backupRecords.instanceId],
    references: [instances.id],
  }),
}))

// Re-export sql for convenience in call sites.
export { sql }
