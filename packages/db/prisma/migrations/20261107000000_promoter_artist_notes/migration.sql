-- A promoter's private running note on a DJ, so the next application is judged
-- with the previous decision in view. One row per promoter/DJ pair; the DJ and
-- other promoters never see it.
CREATE TABLE "ArtistNote" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "promoterId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistNote_pkey" PRIMARY KEY ("id")
);

-- One note per pair: saving again edits the same row instead of stacking up.
CREATE UNIQUE INDEX "ArtistNote_promoterId_artistId_key" ON "ArtistNote"("promoterId", "artistId");
CREATE INDEX "ArtistNote_artistId_idx" ON "ArtistNote"("artistId");

ALTER TABLE "ArtistNote" ADD CONSTRAINT "ArtistNote_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistNote" ADD CONSTRAINT "ArtistNote_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
