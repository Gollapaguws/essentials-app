-- Baseline for tables the application has always used but no migration created.
--
-- These were added to the schema and pushed straight to the database with
-- `prisma db push`, so a fresh `migrate deploy` failed at the first reference to
-- "SocialPost" (20261125120000_organisations). Dated before that migration so a
-- new database gets them in order. `IF NOT EXISTS` makes it a no-op on a
-- database where the tables already exist, which is the normal case.
--
-- Shapes match schema.prisma. Columns added later (SocialPost.orgId,
-- SocialPost.meteredAt) come from their own migrations.

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read");

CREATE TABLE IF NOT EXISTS "SiteContent" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "SiteVisit" (
  "id" TEXT NOT NULL,
  "visitorKey" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SiteVisit_visitorKey_path_day_key"
  ON "SiteVisit"("visitorKey", "path", "day");
CREATE INDEX IF NOT EXISTS "SiteVisit_day_idx" ON "SiteVisit"("day");

CREATE TABLE IF NOT EXISTS "StreamTarget" (
  "id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "label" TEXT,
  "url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StreamTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SocialPost" (
  "id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "platforms" TEXT[] NOT NULL,
  "mediaUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scheduledAt" TIMESTAMP(3),
  "results" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SocialPost_status_scheduledAt_idx" ON "SocialPost"("status", "scheduledAt");

-- The same drift left these columns in the schema but in no migration. They are
-- read and written by the booking flow, so a fresh database needs them too.
ALTER TABLE "ArtistBooking" ADD COLUMN IF NOT EXISTS "slot" TEXT;
ALTER TABLE "ArtistBooking" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
