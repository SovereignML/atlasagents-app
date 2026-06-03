CREATE TABLE "DatabaseBackup" (
	"id" text PRIMARY KEY NOT NULL,
	"objectKey" text NOT NULL,
	"fileName" text NOT NULL,
	"sizeBytes" bigint,
	"status" text NOT NULL,
	"error" text,
	"trigger" text NOT NULL,
	"createdByUserId" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "R2BackupConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"bucket" text NOT NULL,
	"endpoint" text,
	"accessKeyIdEnc" text NOT NULL,
	"secretAccessKeyEnc" text NOT NULL,
	"retentionCount" integer DEFAULT 14 NOT NULL,
	"updatedByUserId" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "llmProvider" text;--> statement-breakpoint
CREATE INDEX "DatabaseBackup_startedAt_idx" ON "DatabaseBackup" USING btree ("startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "DatabaseBackup_objectKey_key" ON "DatabaseBackup" USING btree ("objectKey");