ALTER TABLE "Wallet" ADD COLUMN "planCredits" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Wallet" ADD COLUMN "planCreditsExpireAt" timestamp;--> statement-breakpoint
ALTER TABLE "Wallet" ADD COLUMN "planCreditsCents" bigint;--> statement-breakpoint
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_planCredits_nonneg" CHECK ("Wallet"."planCredits" >= 0);