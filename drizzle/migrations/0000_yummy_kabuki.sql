CREATE TABLE "Account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "Account_pkey" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "AdminNote" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"authorId" text NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AdminNotification" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"userId" text NOT NULL,
	"instanceId" text,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolvedAt" timestamp,
	"resolvedBy" text,
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"teamId" text,
	"action" text NOT NULL,
	"targetType" text,
	"targetId" text,
	"targetLabel" text,
	"ipAddress" text,
	"userAgent" text,
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BotHost" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"vmId" text NOT NULL,
	"ipAddress" text NOT NULL,
	"region" text NOT NULL,
	"plan" text NOT NULL,
	"capacity" integer DEFAULT 15 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CreditLedger" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"balance" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DomainVerification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"domain" text NOT NULL,
	"nonce" text NOT NULL,
	"verifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InstanceLog" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"stage" text,
	"action" text,
	"result" text,
	"durationMs" integer,
	"detail" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Instance" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"regionId" text NOT NULL,
	"serverConfigId" text NOT NULL,
	"sshKeyId" text,
	"storageGb" integer NOT NULL,
	"billingInterval" text DEFAULT 'month' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ipAddress" text,
	"rootPasswordEnc" text,
	"stripeSubscriptionId" text,
	"lastTransitionAt" timestamp,
	"provisionAttempts" integer DEFAULT 0 NOT NULL,
	"deletionAttempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"reconciledAt" timestamp,
	"agentType" text,
	"agentConfig" jsonb,
	"soulMd" text,
	"skills" jsonb,
	"modelTier" text,
	"botToken" text,
	"sshHostFingerprint" text,
	"lastActiveAt" timestamp,
	"deletedAt" timestamp,
	"deploymentTarget" text,
	"interfaceKind" text,
	"telegramBotTokenEnc" text,
	"telegramUsername" text,
	"botHostId" text,
	"containerName" text,
	"containerPort" integer,
	"vmId" text,
	"domain" text,
	"dnsStatus" text,
	"tlsStatus" text,
	"managedSubdomain" text,
	"cfRecordId" text,
	"openclawAdminEmail" text,
	"openclawAdminPasswordEnc" text,
	"gatewayTokenEnc" text,
	"openRouterKeyId" text,
	"openRouterKeyEnc" text,
	"provisionStage" text,
	"failedStage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Membership" (
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'developer' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Membership_pkey" PRIMARY KEY("teamId","userId")
);
--> statement-breakpoint
CREATE TABLE "OrphanEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"vmId" text NOT NULL,
	"instanceId" text,
	"action" text NOT NULL,
	"detectedAt" timestamp DEFAULT now() NOT NULL,
	"resolvedAt" timestamp,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "Plan" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"tier" text NOT NULL,
	"stripePriceIdMonthly" text,
	"stripePriceIdYearly" text,
	"features" jsonb NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"creditsPerPeriod" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProcessedEvent" (
	"source" text NOT NULL,
	"eventId" text NOT NULL,
	"processedAt" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb,
	CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY("source","eventId")
);
--> statement-breakpoint
CREATE TABLE "RateLimitBucket" (
	"key" text NOT NULL,
	"windowStart" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY("key","windowStart")
);
--> statement-breakpoint
CREATE TABLE "Region" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"flag" text NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"providerRegion" text DEFAULT 'us-east' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ServerConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"vcpu" integer NOT NULL,
	"ramGb" integer NOT NULL,
	"storageGb" integer NOT NULL,
	"priceMonthly" double precision NOT NULL,
	"priceYearly" double precision NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"providerPlan" text DEFAULT 'g6-standard-2' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SshKey" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"publicKey" text NOT NULL,
	"fingerprint" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"planId" text NOT NULL,
	"instanceId" text,
	"stripeSubscriptionId" text,
	"stripePriceId" text,
	"interval" text DEFAULT 'month' NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"currentPeriodEnd" timestamp,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TeamInvite" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'developer' NOT NULL,
	"token" text NOT NULL,
	"invitedById" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"acceptedAt" timestamp,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ownerId" text NOT NULL,
	"seatLimit" integer DEFAULT 5 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UsageEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp,
	"hashedPassword" text,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"isBanned" boolean DEFAULT false NOT NULL,
	"bannedAt" timestamp,
	"bannedReason" text,
	"telegramId" text,
	"twitterHandle" text,
	"discordId" text,
	"stripeCustomerId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"activeTeamId" text,
	"twoFactorSecret" text,
	"twoFactorEnabled" boolean DEFAULT false NOT NULL,
	"twoFactorBackupCodes" jsonb,
	"twoFactorEnrolledAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "VerificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "VerificationToken_pkey" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "WalletTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"walletId" text NOT NULL,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"instanceId" text,
	"balanceAfter" double precision NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Wallet" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"balance" double precision DEFAULT 0 NOT NULL,
	"minimumBalance" double precision DEFAULT 200 NOT NULL,
	"balanceCents" bigint,
	"minimumBalanceCents" bigint,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Wallet_balance_nonneg" CHECK ("Wallet"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DomainVerification" ADD CONSTRAINT "DomainVerification_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InstanceLog" ADD CONSTRAINT "InstanceLog_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_regionId_Region_id_fk" FOREIGN KEY ("regionId") REFERENCES "public"."Region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_serverConfigId_ServerConfig_id_fk" FOREIGN KEY ("serverConfigId") REFERENCES "public"."ServerConfig"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_sshKeyId_SshKey_id_fk" FOREIGN KEY ("sshKeyId") REFERENCES "public"."SshKey"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_botHostId_BotHost_id_fk" FOREIGN KEY ("botHostId") REFERENCES "public"."BotHost"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OrphanEvent" ADD CONSTRAINT "OrphanEvent_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SshKey" ADD CONSTRAINT "SshKey_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedById_User_id_fk" FOREIGN KEY ("invitedById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_Wallet_id_fk" FOREIGN KEY ("walletId") REFERENCES "public"."Wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AdminNote_userId_idx" ON "AdminNote" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "AdminNotification_type_resolved_idx" ON "AdminNotification" USING btree ("type","resolved");--> statement-breakpoint
CREATE INDEX "AdminNotification_userId_idx" ON "AdminNotification" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_teamId_idx" ON "AuditLog" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "AuditLog_action_idx" ON "AuditLog" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "BotHost_vmId_key" ON "BotHost" USING btree ("vmId");--> statement-breakpoint
CREATE INDEX "BotHost_status_idx" ON "BotHost" USING btree ("status");--> statement-breakpoint
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "DomainVerification_userId_domain_key" ON "DomainVerification" USING btree ("userId","domain");--> statement-breakpoint
CREATE INDEX "DomainVerification_domain_idx" ON "DomainVerification" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "InstanceLog_instanceId_idx" ON "InstanceLog" USING btree ("instanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "Instance_slug_key" ON "Instance" USING btree ("slug") WHERE "deletedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Instance_stripeSubscriptionId_key" ON "Instance" USING btree ("stripeSubscriptionId");--> statement-breakpoint
CREATE UNIQUE INDEX "Instance_botToken_key" ON "Instance" USING btree ("botToken");--> statement-breakpoint
CREATE INDEX "Instance_userId_idx" ON "Instance" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Instance_status_idx" ON "Instance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Instance_botHostId_idx" ON "Instance" USING btree ("botHostId");--> statement-breakpoint
CREATE INDEX "Membership_userId_idx" ON "Membership" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "OrphanEvent_vmId_idx" ON "OrphanEvent" USING btree ("vmId");--> statement-breakpoint
CREATE INDEX "OrphanEvent_action_idx" ON "OrphanEvent" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket" USING btree ("windowStart");--> statement-breakpoint
CREATE UNIQUE INDEX "Region_slug_key" ON "Region" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ServerConfig_slug_key" ON "ServerConfig" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "SshKey_userId_idx" ON "SshKey" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_instanceId_key" ON "Subscription" USING btree ("instanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription" USING btree ("stripeSubscriptionId");--> statement-breakpoint
CREATE INDEX "Subscription_userId_idx" ON "Subscription" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Subscription_status_idx" ON "Subscription" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite" USING btree ("token");--> statement-breakpoint
CREATE INDEX "TeamInvite_teamId_idx" ON "TeamInvite" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite" USING btree ("email");--> statement-breakpoint
CREATE INDEX "Team_ownerId_idx" ON "Team" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "UsageEvent_instanceId_createdAt_idx" ON "UsageEvent" USING btree ("instanceId","createdAt");--> statement-breakpoint
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User" USING btree ("stripeCustomerId");--> statement-breakpoint
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction" USING btree ("walletId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet" USING btree ("userId");