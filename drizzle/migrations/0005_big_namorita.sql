CREATE TABLE "CloudflareConnection" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"apiTokenEnc" text NOT NULL,
	"accountName" text,
	"email" text,
	"connectedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProviderBilling" (
	"id" text PRIMARY KEY NOT NULL,
	"providerId" text NOT NULL,
	"monthlyCreditsUsd" double precision DEFAULT 0 NOT NULL,
	"currentUsageUsd" double precision DEFAULT 0 NOT NULL,
	"softLimitUsd" double precision,
	"hardLimitUsd" double precision,
	"burnRateUsdPerDay" double precision DEFAULT 0 NOT NULL,
	"cycleStart" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProviderHealthLog" (
	"id" text PRIMARY KEY NOT NULL,
	"providerId" text NOT NULL,
	"status" text NOT NULL,
	"latencyMs" integer,
	"detail" jsonb,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProviderPlan" (
	"id" text PRIMARY KEY NOT NULL,
	"providerId" text NOT NULL,
	"serverConfigId" text NOT NULL,
	"providerPlanCode" text NOT NULL,
	"monthlyCostUsd" double precision NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProviderRegion" (
	"id" text PRIMARY KEY NOT NULL,
	"providerId" text NOT NULL,
	"regionId" text NOT NULL,
	"providerRegionCode" text NOT NULL,
	"available" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Provider" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"pinnedRegionId" text,
	"credentialEnvKey" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RoutingLog" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text,
	"regionId" text,
	"serverConfigId" text,
	"workloadType" text,
	"chosenProviderId" text,
	"score" double precision,
	"breakdown" jsonb,
	"rejected" jsonb,
	"outcome" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "providerId" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "cfZoneId" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "cfUserRecordId" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "domainProxied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CloudflareConnection" ADD CONSTRAINT "CloudflareConnection_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderBilling" ADD CONSTRAINT "ProviderBilling_providerId_Provider_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderHealthLog" ADD CONSTRAINT "ProviderHealthLog_providerId_Provider_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderPlan" ADD CONSTRAINT "ProviderPlan_providerId_Provider_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderPlan" ADD CONSTRAINT "ProviderPlan_serverConfigId_ServerConfig_id_fk" FOREIGN KEY ("serverConfigId") REFERENCES "public"."ServerConfig"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderRegion" ADD CONSTRAINT "ProviderRegion_providerId_Provider_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderRegion" ADD CONSTRAINT "ProviderRegion_regionId_Region_id_fk" FOREIGN KEY ("regionId") REFERENCES "public"."Region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_pinnedRegionId_Region_id_fk" FOREIGN KEY ("pinnedRegionId") REFERENCES "public"."Region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RoutingLog" ADD CONSTRAINT "RoutingLog_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RoutingLog" ADD CONSTRAINT "RoutingLog_chosenProviderId_Provider_id_fk" FOREIGN KEY ("chosenProviderId") REFERENCES "public"."Provider"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "CloudflareConnection_userId_key" ON "CloudflareConnection" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderBilling_providerId_key" ON "ProviderBilling" USING btree ("providerId");--> statement-breakpoint
CREATE INDEX "ProviderHealthLog_provider_checkedAt_idx" ON "ProviderHealthLog" USING btree ("providerId","checkedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderPlan_provider_config_key" ON "ProviderPlan" USING btree ("providerId","serverConfigId");--> statement-breakpoint
CREATE INDEX "ProviderPlan_serverConfigId_idx" ON "ProviderPlan" USING btree ("serverConfigId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderRegion_provider_region_key" ON "ProviderRegion" USING btree ("providerId","regionId");--> statement-breakpoint
CREATE INDEX "ProviderRegion_regionId_idx" ON "ProviderRegion" USING btree ("regionId");--> statement-breakpoint
CREATE UNIQUE INDEX "Provider_slug_key" ON "Provider" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "RoutingLog_instanceId_idx" ON "RoutingLog" USING btree ("instanceId");--> statement-breakpoint
CREATE INDEX "RoutingLog_createdAt_idx" ON "RoutingLog" USING btree ("createdAt");--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_providerId_Provider_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE no action ON UPDATE no action;