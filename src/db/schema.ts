// Drizzle schema — single source of truth for the Postgres database.
//
// `drizzle-kit push` syncs this file → Postgres. No migration lockfile,
// no `migrate deploy`, no codegen step.

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  primaryKey,
  uniqueIndex,
  index,
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
    credits: integer().default(0).notNull(),
    activeTeamId: text(),
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
    lastActiveAt: timestamp({ mode: "date", withTimezone: false }),
    /** Set when status becomes `deleted` — used for admin audit / sorting */
    deletedAt: timestamp({ mode: "date", withTimezone: false }),
    deploymentTarget: text(),
    interfaceKind: text(),
    telegramBotTokenEnc: text(),
    telegramUsername: text(),
    botHostId: text().references(() => botHosts.id),
    containerName: text(),
    containerPort: integer(),
    vmId: text(),

    // OpenClaw agent deploy — dns/tls are only populated when a domain is
    // configured. NULL = "not applicable", never synthesize a fake value.
    domain: text(),
    dnsStatus: text(),
    tlsStatus: text(),
    managedSubdomain: text(),
    cfRecordId: text(),
    openclawAdminEmail: text(),
    openclawAdminPasswordEnc: text(),
    gatewayTokenEnc: text(),

    provisionStage: text(),
    failedStage: text(),

    createdAt: now(),
    updatedAt: timestamp({ mode: "date", withTimezone: false })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("Instance_slug_key").on(t.slug),
    uniqueIndex("Instance_stripeSubscriptionId_key").on(t.stripeSubscriptionId),
    uniqueIndex("Instance_botToken_key").on(t.botToken),
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

// ──────────────────────────────────────────────────────────────────────
// Relations (enables db.query.<table>.findMany({ with: { ... } }))
// ──────────────────────────────────────────────────────────────────────

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))

export const usersRelations = relations(users, ({ many }) => ({
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
}))

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, { fields: [teams.ownerId], references: [users.id] }),
  memberships: many(memberships),
  invites: many(teamInvites),
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
  logs: many(instanceLogs),
  subscription: one(subscriptions),
  usageEvents: many(usageEvents),
}))

export const botHostsRelations = relations(botHosts, ({ many }) => ({
  instances: many(instances),
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

// Re-export sql for convenience in call sites.
export { sql }
