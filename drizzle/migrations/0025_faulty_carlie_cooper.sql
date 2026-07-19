CREATE TABLE "WarmVm" (
	"id" text PRIMARY KEY NOT NULL,
	"poolKey" text NOT NULL,
	"providerId" text,
	"providerSlug" text NOT NULL,
	"providerPlanCode" text NOT NULL,
	"providerRegionCode" text NOT NULL,
	"runtime" text NOT NULL,
	"webuiEnabled" boolean DEFAULT false NOT NULL,
	"vmId" text,
	"ipAddress" text,
	"rootPasswordEnc" text,
	"sshHostFingerprint" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"claimedByInstanceId" text,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"readyAt" timestamp,
	"claimedAt" timestamp,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "WarmVm" ADD CONSTRAINT "WarmVm_providerId_Provider_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."Provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WarmVm" ADD CONSTRAINT "WarmVm_claimedByInstanceId_Instance_id_fk" FOREIGN KEY ("claimedByInstanceId") REFERENCES "public"."Instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "WarmVm_poolKey_status_idx" ON "WarmVm" USING btree ("poolKey","status");--> statement-breakpoint
CREATE INDEX "WarmVm_status_idx" ON "WarmVm" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "WarmVm_vmId_key" ON "WarmVm" USING btree ("vmId");