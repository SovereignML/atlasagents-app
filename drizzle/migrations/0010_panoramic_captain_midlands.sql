CREATE TABLE "TenantConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"defaultChildAgentLimit" integer,
	"defaultChildSeatLimit" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Team" ADD COLUMN "parentTeamId" text;--> statement-breakpoint
ALTER TABLE "Team" ADD COLUMN "suspendedAt" timestamp;--> statement-breakpoint
ALTER TABLE "Team" ADD COLUMN "agentLimit" integer;--> statement-breakpoint
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TenantConfig_teamId_key" ON "TenantConfig" USING btree ("teamId");--> statement-breakpoint
ALTER TABLE "Team" ADD CONSTRAINT "Team_parentTeamId_Team_id_fk" FOREIGN KEY ("parentTeamId") REFERENCES "public"."Team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Team_parentTeamId_idx" ON "Team" USING btree ("parentTeamId");