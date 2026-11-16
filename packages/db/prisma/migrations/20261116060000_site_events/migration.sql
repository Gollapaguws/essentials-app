-- Anonymous daily counts for the PWA install funnel.
CREATE TABLE "SiteEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteEvent_name_visitorKey_day_key" ON "SiteEvent"("name", "visitorKey", "day");
CREATE INDEX "SiteEvent_day_idx" ON "SiteEvent"("day");
