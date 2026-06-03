CREATE TABLE "TeamBranding" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"brandName" text,
	"logoUrl" text,
	"logoMarkUrl" text,
	"faviconUrl" text,
	"supportEmail" text,
	"primaryLight" text,
	"accentLight" text,
	"primaryDark" text,
	"accentDark" text,
	"customDomain" text,
	"domainVerifiedAt" timestamp,
	"dnsStatus" text,
	"tlsStatus" text,
	"brandingEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TeamBrandingAsset" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"kind" text NOT NULL,
	"contentType" text NOT NULL,
	"dataBase64" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "kumaMonitorId" integer;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "kumaStatus" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "kumaResponseTimeMs" integer;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "kumaUptimeRatio" double precision;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "kumaCertDaysRemaining" integer;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "kumaCheckedAt" timestamp;--> statement-breakpoint
ALTER TABLE "TeamBranding" ADD CONSTRAINT "TeamBranding_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TeamBrandingAsset" ADD CONSTRAINT "TeamBrandingAsset_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TeamBranding_teamId_key" ON "TeamBranding" USING btree ("teamId");--> statement-breakpoint
CREATE UNIQUE INDEX "TeamBranding_customDomain_key" ON "TeamBranding" USING btree ("customDomain");--> statement-breakpoint
CREATE INDEX "TeamBranding_customDomain_idx" ON "TeamBranding" USING btree ("customDomain");--> statement-breakpoint
CREATE UNIQUE INDEX "TeamBrandingAsset_teamId_kind_key" ON "TeamBrandingAsset" USING btree ("teamId","kind");