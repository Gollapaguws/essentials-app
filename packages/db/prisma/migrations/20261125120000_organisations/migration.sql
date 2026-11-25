-- Customer workspaces. Until now every account shared one platform: events were
-- isolated by promoter id, but social posts had no owner at all. An organisation
-- is the paying customer; a membership says who may act inside it.

CREATE TABLE "Organisation" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'promoter',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");
CREATE INDEX "Organisation_kind_idx" ON "Organisation"("kind");

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "Membership_orgId_role_idx" ON "Membership"("orgId", "role");

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One workspace per existing promoter, named after the account. The platform
-- workspace holds administrators and any row whose owner is not a promoter.
INSERT INTO "Organisation" ("id", "name", "slug", "kind", "createdAt", "updatedAt")
SELECT
  'org-' || u."id",
  COALESCE(NULLIF(BTRIM(u."name"), ''), split_part(u."email", '@', 1)) || ' Presents',
  'promoter-' || u."id",
  'promoter',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'promoter'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Organisation" ("id", "name", "slug", "kind", "createdAt", "updatedAt")
VALUES ('org-sonus', 'SONUS', 'sonus', 'platform', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Membership" ("id", "orgId", "userId", "role", "createdAt")
SELECT 'mem-' || u."id", 'org-' || u."id", u."id", u."role", CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'promoter'
ON CONFLICT ("orgId", "userId") DO NOTHING;

INSERT INTO "Membership" ("id", "orgId", "userId", "role", "createdAt")
SELECT 'mem-sonus-' || u."id", 'org-sonus', u."id", u."role", CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id")
ON CONFLICT ("orgId", "userId") DO NOTHING;

ALTER TABLE "Event" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Venue" ADD COLUMN "orgId" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "orgId" TEXT;

UPDATE "Event" e
SET "orgId" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "Organisation" o WHERE o."id" = 'org-' || e."promoterId"
  ) THEN 'org-' || e."promoterId"
  ELSE 'org-sonus'
END;

UPDATE "Venue" v
SET "orgId" = CASE
  WHEN v."managerId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Organisation" o WHERE o."id" = 'org-' || v."managerId"
  ) THEN 'org-' || v."managerId"
  ELSE 'org-sonus'
END;

UPDATE "SocialPost" p
SET "orgId" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "Organisation" o WHERE o."id" = 'org-' || p."createdBy"
  ) THEN 'org-' || p."createdBy"
  ELSE 'org-sonus'
END;

CREATE INDEX "Event_orgId_date_idx" ON "Event"("orgId", "date");
CREATE INDEX "Venue_orgId_idx" ON "Venue"("orgId");
CREATE INDEX "SocialPost_orgId_createdAt_idx" ON "SocialPost"("orgId", "createdAt");

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Venue"
  ADD CONSTRAINT "Venue_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocialPost"
  ADD CONSTRAINT "SocialPost_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
