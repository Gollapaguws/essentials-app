-- One standard travel rate for every DJ: admin-controlled, not a profile choice.
ALTER TABLE "ArtistProfile" ALTER COLUMN "travelRatePerKm" SET DEFAULT 4.95;
UPDATE "ArtistProfile" SET "travelRatePerKm" = 4.95;
