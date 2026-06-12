CREATE TABLE "AllowedModel" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "fbclid" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "gclid" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "adClickCapturedAt" timestamp;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "marketingConsent" boolean;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "consentUpdatedAt" timestamp;