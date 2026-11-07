-- Promoter-defined slot plan and DJ budget. `budget` is split equally across the
-- slots, and the plan fields are kept so the promoter can reopen the form.
ALTER TABLE "Event"
    ADD COLUMN "budget" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "slotCount" INTEGER,
    ADD COLUMN "slotMinutes" INTEGER,
    ADD COLUMN "slotStartMinute" INTEGER;

CREATE TABLE "EventSlot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventSlot_pkey" PRIMARY KEY ("id")
);

-- Two slots cannot start at the same moment on one event.
CREATE UNIQUE INDEX "EventSlot_eventId_startsAt_key" ON "EventSlot"("eventId", "startsAt");
CREATE INDEX "EventSlot_eventId_idx" ON "EventSlot"("eventId");

-- Bookings point at the slot they applied for; legacy bookings keep only `slot`.
ALTER TABLE "ArtistBooking" ADD COLUMN "slotId" TEXT;
CREATE INDEX "ArtistBooking_slotId_idx" ON "ArtistBooking"("slotId");

ALTER TABLE "EventSlot" ADD CONSTRAINT "EventSlot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistBooking" ADD CONSTRAINT "ArtistBooking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "EventSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
