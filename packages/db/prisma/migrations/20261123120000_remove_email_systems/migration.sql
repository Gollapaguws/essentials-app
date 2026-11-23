-- Remove the in-platform email systems: campaigns, segments, delivery jobs,
-- consent evidence, newsletter broadcasting and campaign attribution.
ALTER TABLE "GuestList" DROP CONSTRAINT IF EXISTS "GuestList_sourceCampaignId_fkey";
ALTER TABLE "GuestList" DROP COLUMN IF EXISTS "sourceCampaignId";

DROP TABLE IF EXISTS "EmailJob";
DROP TABLE IF EXISTS "Campaign";
DROP TABLE IF EXISTS "EmailSegment";
DROP TABLE IF EXISTS "EmailEvent";
DROP TABLE IF EXISTS "Consent";
DROP TABLE IF EXISTS "WhatsNewBroadcast";

DROP TYPE IF EXISTS "CampaignStatus";
DROP TYPE IF EXISTS "ConsentChannel";
DROP TYPE IF EXISTS "ConsentStatus";
