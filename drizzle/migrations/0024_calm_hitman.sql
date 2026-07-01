ALTER TABLE "Subscription" ADD COLUMN "nextCreditGrantAt" timestamp;--> statement-breakpoint
CREATE INDEX "Subscription_nextCreditGrantAt_idx" ON "Subscription" USING btree ("nextCreditGrantAt");