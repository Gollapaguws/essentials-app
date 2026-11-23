-- Each slot now carries its place in the night's arc: role, BPM band and genres.
ALTER TABLE "EventSlot"
  ADD COLUMN "role" TEXT,
  ADD COLUMN "bpmRange" TEXT,
  ADD COLUMN "genres" TEXT;

-- Backfill: the phase is decided by how long after the first slot this one starts,
-- so an eight-hour night lines up with the published arc.
WITH offsets AS (
  SELECT
    id,
    (EXTRACT(EPOCH FROM ("startsAt" - MIN("startsAt") OVER (PARTITION BY "eventId"))) / 60)::int
      AS offset_minutes
  FROM "EventSlot"
)
UPDATE "EventSlot" s
SET
  "role" = CASE
    WHEN o.offset_minutes < 100 THEN 'The Setter (Warm-Up)'
    WHEN o.offset_minutes < 200 THEN 'The Deep Bridge'
    WHEN o.offset_minutes < 300 THEN 'The Rising Builder'
    WHEN o.offset_minutes < 400 THEN 'The Peak Architect'
    ELSE 'The Closer (Euphoric)'
  END,
  "bpmRange" = CASE
    WHEN o.offset_minutes < 100 THEN '124–128'
    WHEN o.offset_minutes < 200 THEN '128–133'
    WHEN o.offset_minutes < 300 THEN '133–139'
    WHEN o.offset_minutes < 400 THEN '139–148'
    ELSE '145 → 140 → 132'
  END,
  "genres" = CASE
    WHEN o.offset_minutes < 100 THEN 'Minimal · Deep Progressive · Understated Tech House'
    WHEN o.offset_minutes < 200 THEN 'Progressive · Rolling Tech House · Minimal'
    WHEN o.offset_minutes < 300 THEN 'Tech House · Progressive · Psy Tech · Techno'
    WHEN o.offset_minutes < 400 THEN 'Techno · Psy Tech · Peak Tech House'
    ELSE 'Melodic · Trance · Progressive'
  END
FROM offsets o
WHERE s.id = o.id;
