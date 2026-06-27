CREATE TABLE "InstanceKnowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"textContent" text DEFAULT '' NOT NULL,
	"sourceUrl" text,
	"sizeBytes" integer,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "InstanceKnowledge" ADD CONSTRAINT "InstanceKnowledge_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InstanceKnowledge" ADD CONSTRAINT "InstanceKnowledge_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "InstanceKnowledge_instanceId_idx" ON "InstanceKnowledge" USING btree ("instanceId");