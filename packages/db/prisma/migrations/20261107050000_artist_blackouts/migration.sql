-- Dates a DJ has blocked out; applications on those days are refused.
CREATE TABLE "ArtistBlackout" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistBlackout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtistBlackout_artistId_date_key" ON "ArtistBlackout"("artistId", "date");
CREATE INDEX "ArtistBlackout_artistId_date_idx" ON "ArtistBlackout"("artistId", "date");

ALTER TABLE "ArtistBlackout" ADD CONSTRAINT "ArtistBlackout_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
