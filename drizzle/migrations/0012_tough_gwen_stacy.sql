ALTER TABLE "SupportTicket" ADD COLUMN "chatwootTenantTeamId" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "chatwootBaseUrl" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "chatwootApiTokenEnc" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "chatwootAccountId" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "chatwootInboxId" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "chatwootWebsiteToken" text;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD COLUMN "chatwootHmacTokenEnc" text;