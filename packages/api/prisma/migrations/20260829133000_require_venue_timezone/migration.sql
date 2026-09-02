-- VW-24 / product decision documented in the accompanying audit: require
-- Venue.timezone rather than silently falling back to UTC scattered across
-- every date/time helper in the codebase. Every venue-creation path now
-- resolves a concrete value before writing (see app.controller.ts and
-- site/index.html), so this backfills any existing null to "UTC" — the same
-- value those call sites already fell back to — before making the column
-- NOT NULL.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified.

UPDATE "Venue" SET "timezone" = 'UTC' WHERE "timezone" IS NULL;

ALTER TABLE "Venue" ALTER COLUMN "timezone" SET DEFAULT 'UTC';
ALTER TABLE "Venue" ALTER COLUMN "timezone" SET NOT NULL;
