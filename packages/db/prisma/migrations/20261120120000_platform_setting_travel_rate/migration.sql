-- One travel rate for every DJ on the platform.
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- Profiles created before the standard could carry their own negotiated rate.
-- Move every one onto the R4.95/km platform rate; invoices already issued keep
-- the amounts they were billed at because they store their own totals.
UPDATE "ArtistProfile" SET "travelRatePerKm" = 4.95;

-- The standard itself, so new profiles and future rate changes read one value.
INSERT INTO "PlatformSetting" ("key", "value", "updatedAt")
VALUES ('travelRatePerKm', '4.95', CURRENT_TIMESTAMP);
