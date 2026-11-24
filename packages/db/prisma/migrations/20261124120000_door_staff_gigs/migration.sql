-- Door staff can be booked like DJs: an event declares a door fee that counts
-- against its budget, door hosts apply, the promoter confirms and later marks
-- the shift worked, and the host invoices the venue with travel.

CREATE TYPE "DoorBookingStatus" AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');

ALTER TABLE "Event"
  ADD COLUMN "doorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "doorFee" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "DoorProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "homeAddress" TEXT,
  "homeLat" DOUBLE PRECISION,
  "homeLng" DOUBLE PRECISION,
  "travelRatePerKm" DOUBLE PRECISION NOT NULL DEFAULT 4.95,
  "bankAccountHolder" TEXT,
  "bankName" TEXT,
  "bankAccountNumber" TEXT,
  "bankBranchCode" TEXT,
  "bankAccountType" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DoorProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoorProfile_userId_key" ON "DoorProfile"("userId");

CREATE TABLE "DoorBooking" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "fee" INTEGER NOT NULL DEFAULT 0,
  "travelFee" INTEGER NOT NULL DEFAULT 0,
  "status" "DoorBookingStatus" NOT NULL DEFAULT 'pending',
  "appliedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "declineReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DoorBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoorBooking_eventId_profileId_key" ON "DoorBooking"("eventId", "profileId");
CREATE INDEX "DoorBooking_eventId_status_idx" ON "DoorBooking"("eventId", "status");
CREATE INDEX "DoorBooking_profileId_idx" ON "DoorBooking"("profileId");

CREATE TABLE "DoorInvoice" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "venueId" TEXT,
  "number" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
  "total" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DoorInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoorInvoice_bookingId_key" ON "DoorInvoice"("bookingId");
CREATE UNIQUE INDEX "DoorInvoice_number_key" ON "DoorInvoice"("number");
CREATE INDEX "DoorInvoice_profileId_idx" ON "DoorInvoice"("profileId");

CREATE TABLE "DoorInvoiceItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,

  CONSTRAINT "DoorInvoiceItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DoorProfile"
  ADD CONSTRAINT "DoorProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DoorBooking"
  ADD CONSTRAINT "DoorBooking_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoorBooking"
  ADD CONSTRAINT "DoorBooking_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "DoorProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DoorInvoice"
  ADD CONSTRAINT "DoorInvoice_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "DoorProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DoorInvoice"
  ADD CONSTRAINT "DoorInvoice_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "DoorBooking"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoorInvoice"
  ADD CONSTRAINT "DoorInvoice_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DoorInvoiceItem"
  ADD CONSTRAINT "DoorInvoiceItem_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "DoorInvoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
