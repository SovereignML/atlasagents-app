ALTER TABLE "Instance" ADD COLUMN "telegramWebhookId" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "telegramWebhookSecretEnc" text;--> statement-breakpoint
CREATE UNIQUE INDEX "Instance_telegramWebhookId_key" ON "Instance" USING btree ("telegramWebhookId");