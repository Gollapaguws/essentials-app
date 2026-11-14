-- Per-account opt-out from mandatory two-step verification. Defaults to false,
-- so the role policy is unchanged for every existing account.
ALTER TABLE "User" ADD COLUMN "mfaDisabled" BOOLEAN NOT NULL DEFAULT false;
