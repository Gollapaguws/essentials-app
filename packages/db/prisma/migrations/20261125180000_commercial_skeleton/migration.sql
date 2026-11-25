-- Commercial skeleton: hubs, plans, subscriptions and usage counters.
--
-- Nothing is charged here. The point is that every workspace has a plan and a
-- billing period to count against before any paid module or entitlement gate
-- exists. Prices are cents and, until decision 2 is settled, treated as the
-- gross price a customer pays (VAT included).

CREATE TABLE "Hub" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT 'SONUS',
  "status" TEXT NOT NULL DEFAULT 'pilot',
  "config" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Hub_slug_key" ON "Hub"("slug");
CREATE INDEX "Hub_status_idx" ON "Hub"("status");

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceZar" INTEGER NOT NULL DEFAULT 0,
  "entitlements" JSONB NOT NULL DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_hubId_key_key" ON "Plan"("hubId", "key");

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "provider" TEXT,
  "providerRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

CREATE TABLE "UsageCounter" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageCounter_orgId_metric_periodStart_key"
  ON "UsageCounter"("orgId", "metric", "periodStart");
CREATE INDEX "UsageCounter_orgId_periodStart_idx" ON "UsageCounter"("orgId", "periodStart");

ALTER TABLE "Organisation" ADD COLUMN "hubId" TEXT;
CREATE INDEX "Organisation_hubId_idx" ON "Organisation"("hubId");

-- The first hub. Every existing workspace belongs to it; a second vertical gets
-- its own row later, and its own plans, without a new brand.
INSERT INTO "Hub" ("id", "slug", "name", "status", "config", "createdAt")
VALUES (
  'hub-edm',
  'edm',
  'Electronic dance music',
  'pilot',
  '{"genres":["House","Deep House","Tech House","Minimal","Progressive House","Techno","Trance","Psytrance","Psytech","Afro House","Afro Tech"]}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "Organisation" SET "hubId" = 'hub-edm' WHERE "hubId" IS NULL;

ALTER TABLE "Organisation"
  ADD CONSTRAINT "Organisation_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UsageCounter"
  ADD CONSTRAINT "UsageCounter_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Launch plan set from the vision document. The limits are the ones written into
-- the document; they are seeded, not enforced — no gate reads them yet.
INSERT INTO "Plan" ("id", "hubId", "key", "name", "priceZar", "entitlements", "active", "createdAt")
VALUES
  ('plan-edm-basic',    'hub-edm', 'basic',    'Basic profile',                0,     '{}', true, CURRENT_TIMESTAMP),
  ('plan-edm-email',    'hub-edm', 'email',    'Email and database access',    9900,  '{"email.sends": 1000}', true, CURRENT_TIMESTAMP),
  ('plan-edm-database', 'hub-edm', 'database', 'Database import add-on',       4900,  '{"email.contacts": 1000}', true, CURRENT_TIMESTAMP),
  ('plan-edm-social',   'hub-edm', 'social',   'Social Media Hub',             14900, '{"social.accounts": 2, "social.publishes": 60}', true, CURRENT_TIMESTAMP),
  ('plan-edm-viewing',  'hub-edm', 'viewing',  'Viewing Room',                 19900, '{"viewing.sessions": 4}', true, CURRENT_TIMESTAMP),
  ('plan-edm-pro',      'hub-edm', 'pro',      'Complete professional package', 39900,
   '{"email.sends": 1000, "email.contacts": 1000, "social.accounts": 2, "social.publishes": 60, "viewing.sessions": 4}',
   true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Nothing is charged yet, so every existing workspace is comped onto the bundle
-- for a year. Decision 6 (what existing accounts pay, and when) can shorten or
-- extend this window without touching the data model.
INSERT INTO "Subscription"
  ("id", "orgId", "planId", "status", "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd", "provider", "createdAt", "updatedAt")
SELECT
  'sub-' || o."id",
  o."id",
  'plan-edm-pro',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '1 year',
  false,
  'comp',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organisation" o
ON CONFLICT ("orgId") DO NOTHING;
