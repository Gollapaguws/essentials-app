-- Event titles are capped at 50 characters. The API validates the same limit;
-- the column type also covers direct writes outside the HTTP layer.
ALTER TABLE "Event" ALTER COLUMN "title" SET DATA TYPE VARCHAR(50);
