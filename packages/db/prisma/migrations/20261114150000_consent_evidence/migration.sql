-- Evidence for POPIA/CPA electronic-marketing consent.
ALTER TABLE "Consent"
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT '2026-11-14',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "revokedAt" TIMESTAMP(3);
