-- A promoter can shape the night's arc themselves instead of the fixed
-- 100-minute phases; slots are tagged from this when a night is planned.
CREATE TABLE "PromoterNightArc" (
  "promoterId" TEXT NOT NULL,
  "phases" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PromoterNightArc_pkey" PRIMARY KEY ("promoterId")
);

ALTER TABLE "PromoterNightArc"
  ADD CONSTRAINT "PromoterNightArc_promoterId_fkey"
  FOREIGN KEY ("promoterId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
