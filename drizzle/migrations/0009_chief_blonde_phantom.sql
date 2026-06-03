CREATE TABLE "DeletionRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decidedBy" text,
	"decidedAt" timestamp,
	"decisionNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "DeletionRequest_status_idx" ON "DeletionRequest" USING btree ("status");--> statement-breakpoint
CREATE INDEX "DeletionRequest_userId_idx" ON "DeletionRequest" USING btree ("userId");