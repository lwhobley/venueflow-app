-- VW-26 / VW-27: Conversation had no createdAt/updatedAt at all; Availability
-- had updatedAt but no createdAt. Existing rows backfill to the migration
-- run time via DEFAULT CURRENT_TIMESTAMP — the true historical value was
-- never recorded and cannot be recovered.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified.

ALTER TABLE "Conversation"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Availability"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- VW-28: duplicate (case-insensitive) role names were insertable at one
-- venue despite app.controller.ts's addVenueRole already treating them as
-- identical in its check-then-create. Resolve any existing duplicates
-- before deploying (keep the oldest per pair):
--
--   SELECT "venueId", lower(name) AS name_lower, count(*)
--   FROM "VenueRole"
--   GROUP BY "venueId", lower(name)
--   HAVING count(*) > 1;

DELETE FROM "VenueRole" r
WHERE r.id NOT IN (
  SELECT DISTINCT ON ("venueId", lower(name)) id
  FROM "VenueRole"
  ORDER BY "venueId", lower(name), id ASC
);

CREATE UNIQUE INDEX "VenueRole_venue_name_key"
  ON "VenueRole" ("venueId", lower("name"));

-- VW-35: a standalone boolean index that no query ever used alone.
DROP INDEX IF EXISTS "TimeEntry_isOpen_idx";
