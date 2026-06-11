CREATE TABLE "AgentEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"teamId" text NOT NULL,
	"type" text NOT NULL,
	"occurredAt" timestamp,
	"runId" text,
	"sessionId" text,
	"model" text,
	"tokensIn" integer,
	"tokensOut" integer,
	"costUsd" double precision,
	"latencyMs" integer,
	"status" text,
	"detail" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AlertRule" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"instanceId" text,
	"metric" text NOT NULL,
	"comparator" text NOT NULL,
	"threshold" double precision NOT NULL,
	"windowMinutes" integer DEFAULT 60 NOT NULL,
	"cooldownMinutes" integer DEFAULT 60 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lastFiredAt" timestamp,
	"createdBy" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "eventIngestTokenEnc" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "lastEventAt" timestamp;--> statement-breakpoint
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AgentEvent_instanceId_createdAt_idx" ON "AgentEvent" USING btree ("instanceId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentEvent_teamId_createdAt_idx" ON "AgentEvent" USING btree ("teamId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentEvent_type_idx" ON "AgentEvent" USING btree ("type");--> statement-breakpoint
CREATE INDEX "AlertRule_teamId_idx" ON "AlertRule" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "AlertRule_instanceId_idx" ON "AlertRule" USING btree ("instanceId");