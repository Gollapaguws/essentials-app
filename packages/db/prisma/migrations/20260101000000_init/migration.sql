-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'promoter', 'guest', 'artist', 'venue_manager');

-- CreateEnum
CREATE TYPE "VibeTag" AS ENUM ('Chill', 'Party', 'Networking');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'pending_venue_approval', 'approved', 'live', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "GuestListStatus" AS ENUM ('attending', 'waitlisted', 'checked_in');

-- CreateEnum
CREATE TYPE "TableBookingStatus" AS ENUM ('pending', 'confirmed', 'seated', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('email');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('granted', 'revoked');

-- CreateEnum
CREATE TYPE "ArtistBookingStatus" AS ENUM ('pending', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'paid', 'overdue');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar" TEXT,
    "role" "Role" NOT NULL DEFAULT 'guest',
    "musicTastes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vibeTag" "VibeTag",
    "verifiedBadge" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "capacity" INTEGER NOT NULL,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "promoterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "lineup" JSONB NOT NULL DEFAULT '[]',
    "capacity" INTEGER NOT NULL,
    "dressCode" TEXT,
    "ticketUrl" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "revenueSplitPromoterPct" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestList" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "GuestListStatus" NOT NULL DEFAULT 'attending',
    "qrCode" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "sourceCampaignId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueTable" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tableNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "minSpend" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VenueTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableBooking" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promoterId" TEXT NOT NULL,
    "venueTableId" TEXT NOT NULL,
    "tableNumber" TEXT NOT NULL,
    "bottleServiceNotes" TEXT,
    "status" "TableBookingStatus" NOT NULL DEFAULT 'pending',
    "value" INTEGER NOT NULL DEFAULT 0,
    "venueRevenuePct" INTEGER NOT NULL DEFAULT 30,
    "sourceCampaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "sharedMusicTasteScore" INTEGER NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGroupChat" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "EventGroupChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isIcebreaker" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 1,
    "freeEntryAwarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LoyaltyVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeEmail" TEXT NOT NULL,
    "refereeId" TEXT,
    "rewardType" TEXT,
    "rewardIssued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "flow" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "segmentId" TEXT,
    "eventId" TEXT,
    "subject" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSegment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL DEFAULT 'email',
    "status" "ConsentStatus" NOT NULL DEFAULT 'granted',
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'discount',
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 100,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guestListId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "vehicleConsumptionLPer100km" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "travelRatePerKm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,

    CONSTRAINT "ArtistProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistBooking" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "setupBufferMin" INTEGER NOT NULL DEFAULT 60,
    "teardownBufferMin" INTEGER NOT NULL DEFAULT 45,
    "performanceFee" INTEGER NOT NULL DEFAULT 0,
    "travelFee" INTEGER NOT NULL DEFAULT 0,
    "status" "ArtistBookingStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "ArtistBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRouteLeg" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "estimatedFuelCost" DOUBLE PRECISION NOT NULL,
    "isConflict" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BookingRouteLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "total" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "provider" TEXT,
    "reference" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoorLog" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "eventId" TEXT,
    "scannedBy" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Venue_managerId_idx" ON "Venue"("managerId");

-- CreateIndex
CREATE INDEX "Event_venueId_idx" ON "Event"("venueId");

-- CreateIndex
CREATE INDEX "Event_promoterId_idx" ON "Event"("promoterId");

-- CreateIndex
CREATE INDEX "Event_date_status_idx" ON "Event"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuestList_qrCode_key" ON "GuestList"("qrCode");

-- CreateIndex
CREATE INDEX "GuestList_eventId_status_idx" ON "GuestList"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuestList_eventId_userId_key" ON "GuestList"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueTable_venueId_tableNumber_key" ON "VenueTable"("venueId", "tableNumber");

-- CreateIndex
CREATE INDEX "TableBooking_eventId_idx" ON "TableBooking"("eventId");

-- CreateIndex
CREATE INDEX "TableBooking_promoterId_idx" ON "TableBooking"("promoterId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_eventId_user1Id_user2Id_key" ON "Match"("eventId", "user1Id", "user2Id");

-- CreateIndex
CREATE UNIQUE INDEX "EventGroupChat_eventId_key" ON "EventGroupChat"("eventId");

-- CreateIndex
CREATE INDEX "GroupMessage_chatId_createdAt_idx" ON "GroupMessage"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyVisit_userId_eventId_key" ON "LoyaltyVisit"("userId", "eventId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Campaign_flow_status_idx" ON "Campaign"("flow", "status");

-- CreateIndex
CREATE INDEX "EmailJob_campaignId_status_idx" ON "EmailJob"("campaignId", "status");

-- CreateIndex
CREATE INDEX "EmailEvent_email_type_idx" ON "EmailEvent"("email", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_email_channel_key" ON "Consent"("email", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Promotion_eventId_active_idx" ON "Promotion"("eventId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_promotionId_userId_key" ON "PromotionRedemption"("promotionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistProfile_userId_key" ON "ArtistProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "DoorLog_venueId_createdAt_idx" ON "DoorLog"("venueId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestList" ADD CONSTRAINT "GuestList_sourceCampaignId_fkey" FOREIGN KEY ("sourceCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestList" ADD CONSTRAINT "GuestList_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestList" ADD CONSTRAINT "GuestList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueTable" ADD CONSTRAINT "VenueTable_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_sourceCampaignId_fkey" FOREIGN KEY ("sourceCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_venueTableId_fkey" FOREIGN KEY ("venueTableId") REFERENCES "VenueTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGroupChat" ADD CONSTRAINT "EventGroupChat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "EventGroupChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyVisit" ADD CONSTRAINT "LoyaltyVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "EmailSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistProfile" ADD CONSTRAINT "ArtistProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistBooking" ADD CONSTRAINT "ArtistBooking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistBooking" ADD CONSTRAINT "ArtistBooking_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRouteLeg" ADD CONSTRAINT "BookingRouteLeg_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ArtistBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorLog" ADD CONSTRAINT "DoorLog_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

