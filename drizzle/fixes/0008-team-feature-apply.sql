-- Idempotent apply of migration 0008 (team feature) for push-managed DBs.
--
-- These databases have an empty drizzle.__drizzle_migrations, so `db:migrate`
-- cannot be used (it replays from 0000 and aborts on already-existing tables).
-- This mirrors drizzle/migrations/0008_sweet_hannibal_king.sql with IF [NOT]
-- EXISTS guards and DO-block constraint guards so it is additive, safe to run
-- more than once, and applies cleanly on local now and on prod later.
--
-- Sequence: add per-agent ACL table + nullable teamId columns -> seed a
-- personal Team (+ owner Membership) for every user lacking one -> backfill
-- teamId from each owner's personal team -> SET NOT NULL -> indexes.

-- 1. New per-agent access-control table -------------------------------------
CREATE TABLE IF NOT EXISTS "InstanceAccess" (
	"id" text PRIMARY KEY NOT NULL,
	"instanceId" text NOT NULL,
	"userId" text NOT NULL,
	"level" text NOT NULL,
	"grantedById" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "InstanceAccess" ADD CONSTRAINT "InstanceAccess_instanceId_Instance_id_fk" FOREIGN KEY ("instanceId") REFERENCES "public"."Instance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "InstanceAccess" ADD CONSTRAINT "InstanceAccess_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "InstanceAccess" ADD CONSTRAINT "InstanceAccess_grantedById_User_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "InstanceAccess_instanceId_userId_key" ON "InstanceAccess" USING btree ("instanceId","userId");
CREATE INDEX IF NOT EXISTS "InstanceAccess_instanceId_idx" ON "InstanceAccess" USING btree ("instanceId");
CREATE INDEX IF NOT EXISTS "InstanceAccess_userId_idx" ON "InstanceAccess" USING btree ("userId");

-- 2. Drop the now-obsolete per-user unique constraints ----------------------
DROP INDEX IF EXISTS "CloudflareConnection_userId_key";
DROP INDEX IF EXISTS "DriveConnection_userId_key";

-- 3. Add teamId columns NULLABLE (backfilled below before SET NOT NULL) ------
ALTER TABLE "BackupRecord" ADD COLUMN IF NOT EXISTS "teamId" text;
ALTER TABLE "CloudflareConnection" ADD COLUMN IF NOT EXISTS "teamId" text;
ALTER TABLE "DriveConnection" ADD COLUMN IF NOT EXISTS "teamId" text;
ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "teamId" text;
ALTER TABLE "SshKey" ADD COLUMN IF NOT EXISTS "teamId" text;

DO $$ BEGIN
	ALTER TABLE "BackupRecord" ADD CONSTRAINT "BackupRecord_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "CloudflareConnection" ADD CONSTRAINT "CloudflareConnection_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "Instance" ADD CONSTRAINT "Instance_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE "SshKey" ADD CONSTRAINT "SshKey_teamId_Team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Pre-seed a personal team for every user that does not own one ----------
INSERT INTO "Team" ("id", "name", "ownerId", "seatLimit", "createdAt", "updatedAt")
SELECT
	replace(gen_random_uuid()::text, '-', ''),
	CASE WHEN COALESCE(u."name", '') <> '' THEN u."name" || '''s Team'
	     ELSE split_part(u."email", '@', 1) || ' Team' END,
	u."id", 5, now(), now()
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Team" t WHERE t."ownerId" = u."id");

-- ensure every owned team has an owner membership (covers the rows just added)
INSERT INTO "Membership" ("teamId", "userId", "role", "createdAt")
SELECT t."id", t."ownerId", 'owner', now()
FROM "Team" t
WHERE NOT EXISTS (
	SELECT 1 FROM "Membership" m WHERE m."teamId" = t."id" AND m."userId" = t."ownerId"
);

-- 5. Backfill teamId = owning user's personal team (oldest owned team) ------
UPDATE "Instance" i SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = i."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE i."teamId" IS NULL;
UPDATE "SshKey" s SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = s."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE s."teamId" IS NULL;
UPDATE "DriveConnection" d SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = d."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE d."teamId" IS NULL;
UPDATE "CloudflareConnection" c SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = c."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE c."teamId" IS NULL;
UPDATE "BackupRecord" b SET "teamId" = (
	SELECT t."id" FROM "Team" t WHERE t."ownerId" = b."userId"
	ORDER BY t."createdAt" ASC, t."id" ASC LIMIT 1
) WHERE b."teamId" IS NULL;

-- 6. Now that every row has a teamId, enforce NOT NULL ----------------------
ALTER TABLE "BackupRecord" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "CloudflareConnection" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "DriveConnection" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "Instance" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "SshKey" ALTER COLUMN "teamId" SET NOT NULL;

-- 7. Create teamId indexes (unique for the single-connection-per-team tables)
CREATE INDEX IF NOT EXISTS "BackupRecord_teamId_idx" ON "BackupRecord" USING btree ("teamId");
CREATE UNIQUE INDEX IF NOT EXISTS "CloudflareConnection_teamId_key" ON "CloudflareConnection" USING btree ("teamId");
CREATE UNIQUE INDEX IF NOT EXISTS "DriveConnection_teamId_key" ON "DriveConnection" USING btree ("teamId");
CREATE INDEX IF NOT EXISTS "Instance_teamId_idx" ON "Instance" USING btree ("teamId");
CREATE INDEX IF NOT EXISTS "SshKey_teamId_idx" ON "SshKey" USING btree ("teamId");
