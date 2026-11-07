-- Promoters stipulate a per-hour DJ fee; each slot then pays rate × its length.
ALTER TABLE "Event" ADD COLUMN "djFeePerHour" INTEGER NOT NULL DEFAULT 0;

-- A gig is 'completed' only after the promoter confirms it happened, and only a
-- completed gig may be invoiced.
ALTER TYPE "ArtistBookingStatus" ADD VALUE 'completed' BEFORE 'cancelled';
ALTER TABLE "ArtistBooking" ADD COLUMN "completedAt" TIMESTAMP(3);

-- The DJ invoices the venue, once, for the completed gig.
ALTER TABLE "Invoice"
    ADD COLUMN "bookingId" TEXT,
    ADD COLUMN "venueId" TEXT;

CREATE UNIQUE INDEX "Invoice_bookingId_key" ON "Invoice"("bookingId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ArtistBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
