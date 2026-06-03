ALTER TABLE "Team" ADD COLUMN "whiteLabelEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: white-label is now an admin-controlled flag (sole source of truth),
-- so grant it to every team whose owner currently holds an active/trialing
-- enterprise subscription. Without this, existing enterprise customers would
-- lose branding/custom-domain/reseller access the moment this migration lands.
UPDATE "Team" t SET "whiteLabelEnabled" = true
WHERE EXISTS (
  SELECT 1 FROM "Subscription" s
  JOIN "Plan" p ON p.id = s."planId"
  WHERE s."userId" = t."ownerId"
    AND s.status IN ('active', 'trialing')
    AND p.tier = 'enterprise'
);