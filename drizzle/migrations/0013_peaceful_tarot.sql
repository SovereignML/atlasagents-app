ALTER TABLE "Subscription" ALTER COLUMN "planId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "connectAccountId" text;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "teamId" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "stripeConnectAccountId" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "stripeConnectChargesEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "stripeConnectPayoutsEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "openRouterProvisioningKeyEnc" text;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Subscription_teamId_idx" ON "Subscription" USING btree ("teamId");