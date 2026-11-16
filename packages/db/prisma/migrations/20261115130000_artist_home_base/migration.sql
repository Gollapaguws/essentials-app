-- DJ home base: origin for automatically calculated invoice travel.
ALTER TABLE "ArtistProfile"
  ADD COLUMN "homeAddress" TEXT,
  ADD COLUMN "homeLat" DOUBLE PRECISION,
  ADD COLUMN "homeLng" DOUBLE PRECISION;
