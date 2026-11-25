-- A social post consumes one publish allowance when it is created, whether it
-- publishes immediately or is scheduled. `meteredAt` records that, so publishing
-- a scheduled post later cannot be counted a second time and cannot be refused
-- for an allowance it already paid.
ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "meteredAt" TIMESTAMP(3);
