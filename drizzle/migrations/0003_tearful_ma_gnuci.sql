CREATE TABLE "NotificationPreference" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"matrix" jsonb,
	"telegramChatId" text,
	"telegramLinkToken" text,
	"discordWebhookUrl" text,
	"slackWebhookUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Notification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"url" text,
	"instanceId" text,
	"meta" jsonb,
	"readAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "byosHost" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "byosPort" integer DEFAULT 22;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "byosUser" text DEFAULT 'root';--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "byosLlmMode" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "byosOwnApiKeyEnc" text;--> statement-breakpoint
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "NotificationPreference_telegramLinkToken_key" ON "NotificationPreference" USING btree ("telegramLinkToken");--> statement-breakpoint
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification" USING btree ("userId","readAt");--> statement-breakpoint
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification" USING btree ("userId","createdAt");