-- DJ-booked live-stream windows. The ingest WebSocket only accepts a DJ
-- while one of these covers the current time.
CREATE TABLE "LiveBooking" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "title" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveBooking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveBooking_artistId_startsAt_idx" ON "LiveBooking"("artistId", "startsAt");

ALTER TABLE "LiveBooking" ADD CONSTRAINT "LiveBooking_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
