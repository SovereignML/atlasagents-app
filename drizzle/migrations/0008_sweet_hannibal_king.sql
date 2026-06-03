-- Team feature: per-agent ACL (InstanceAccess) + team-scoped providers.
-- New teamId columns are added NULLABLE, backfilled to each owning user's
-- personal team, then set NOT NULL. Personal teams are pre-seeded for any
-- user who lacks one (getOrCreatePersonalTeam is lazy, so some users have
-- none yet). Team ids are generated with gen_random_uuid() — the id column
-- is plain text, so a UUID string is a valid (if differently-shaped) value.

-- 1. New per-agent access-control table -------------------------------------
CREATE TABLE "InstanceAccess" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"userId" text NOT NULL,
	"level" text NOT NULL,
	"grantedById" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "InstanceAccess" ADD CONSTRAINT "InstanceAccess_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InstanceAccess" ADD CONSTRAINT "InstanceAccess_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InstanceAccess" ADD CONSTRAINT "InstanceAccess_grantedById_User_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "InstanceAccess_instanceId_userId_key" ON "InstanceAccess" USING btree ("instanceId","userId");--> statement-breakpoint
CREATE INDEX "InstanceAccess_instanceId_idx" ON "InstanceAccess" USING btree ("instanceId");--> statement-breakpoint
CREATE INDEX "InstanceAccess_userId_idx" ON "InstanceAccess" USING btree ("userId");--> statement-breakpoint

-- 2. Drop the now-obsolete per-user unique constraints ----------------------
DROP INDEX "CloudflareConnection_userId_key";--> statement-breakpoint
DROP INDEX "DriveConnection_userId_key";--> statement-breakpoint

-- 3. Add teamId columns NULLABLE (backfilled below before SET NOT NULL) ------
ALTER TABLE "BackupRecord" ADD COLUMN "teamId" text;--> statement-breakpoint
ALTER TABLE "CloudflareConnection" ADD COLUMN "teamId" text;--> statement-breakpoint
ALTER TABLE "DriveConnection" ADD COLUMN "teamId" text;--> statement-breakpoint
ALTER TABLE "Instance" ADD COLUMN "teamId" text;--> statement-breakpoint
ALTER TABLE "SshKey" ADD COLUMN "teamId" text;--> statement-breakpoint
ALTER TABLE "BackupRecord" ADD CONSTRAINT "BackupRecord_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CloudflareConnection" ADD CONSTRAINT "CloudflareConnection_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SshKey" ADD CONSTRAINT "SshKey_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 4. Pre-seed a personal team for every user that does not own one ----------
INSERT INTO "Team" ("id", "name", "ownerId", "seatLimit", "createdAt", "updatedAt")
SELECT
	replace(gen_random_uuid()::text, '-', ''),
	CASE WHEN COALESCE(u."name", '') <> '' THEN u."name" || '''s Team'
	     ELSE split_part(u."email", '@', 1) || ' Team' END,
	u."id", 5, now(), now()
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Team" t WHERE t."ownerId" = u."id");--> statement-breakpoint

-- ensure every owned team has an owner membership (covers the rows just added)
INSERT INTO "Membership" ("teamId", "userId", "role", "createdAt")
SELECT t."id", t."ownerId", 'owner', now()
FROM "Team" t
WHERE NOT EXISTS (
	SELECT 1 FROM "Membership" m WHERE m."teamId" = t."id" AND m."userId" = t."ownerId"
);--> statement-breakpoint

-- 5. Backfill teamId = owning user's personal team (oldest owned team) ------
UPDATE "Instance" i SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = i."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE i."teamId" IS NULL;--> statement-breakpoint
UPDATE "SshKey" s SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = s."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE s."teamId" IS NULL;--> statement-breakpoint
UPDATE "DriveConnection" d SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = d."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE d."teamId" IS NULL;--> statement-breakpoint
UPDATE "CloudflareConnection" c SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = c."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE c."teamId" IS NULL;--> statement-breakpoint
UPDATE "BackupRecord" b SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = b."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE b."teamId" IS NULL;--> statement-breakpoint

-- 6. Now that every row has a teamId, enforce NOT NULL ----------------------
ALTER TABLE "BackupRecord" ALTER COLUMN "teamId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "CloudflareConnection" ALTER COLUMN "teamId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "DriveConnection" ALTER COLUMN "teamId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Instance" ALTER COLUMN "teamId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "SshKey" ALTER COLUMN "teamId" SET NOT NULL;--> statement-breakpoint

-- 7. Create teamId indexes (unique for the single-connection-per-team tables)
CREATE INDEX "BackupRecord_teamId_idx" ON "BackupRecord" USING btree ("teamId");--> statement-breakpoint
CREATE UNIQUE INDEX "CloudflareConnection_teamId_key" ON "CloudflareConnection" USING btree ("teamId");--> statement-breakpoint
CREATE UNIQUE INDEX "DriveConnection_teamId_key" ON "DriveConnection" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "Instance_teamId_idx" ON "Instance" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "SshKey_teamId_idx" ON "SshKey" USING btree ("teamId");
