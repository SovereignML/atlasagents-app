CREATE TABLE "InstanceUptimeSample" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"status" text,
	"responseTimeMs" integer,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "InstanceUptimeSample" ADD CONSTRAINT "InstanceUptimeSample_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "InstanceUptimeSample_instanceId_checkedAt_idx" ON "InstanceUptimeSample" USING btree ("instanceId","checkedAt");