-- Provision a stable, manager-shareable workplace code for every venue.
-- Existing codes are preserved. New codes use 48 random bits and remain
-- protected by Venue_code_key.
UPDATE "Venue"
SET "code" = 'VW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE "code" IS NULL;

ALTER TABLE "Venue" ALTER COLUMN "code" SET NOT NULL;

-- Normalize inventory names once so imports can use an atomic compound
-- upsert rather than a capped SELECT followed by create/update operations.
ALTER TABLE "BarInventoryItem" ADD COLUMN "normalizedName" TEXT;

UPDATE "BarInventoryItem"
SET "normalizedName" = lower(btrim("name"));

ALTER TABLE "BarInventoryItem" ALTER COLUMN "normalizedName" SET NOT NULL;

CREATE UNIQUE INDEX "BarInventoryItem_venueId_normalizedName_key"
  ON "BarInventoryItem"("venueId", "normalizedName");

ALTER TABLE "BarInventoryItem"
  ADD CONSTRAINT "BarInventoryItem_normalizedName_matches_name_check"
  CHECK ("normalizedName" = lower(btrim("name"))) NOT VALID;

ALTER TABLE "BarInventoryItem"
  VALIDATE CONSTRAINT "BarInventoryItem_normalizedName_matches_name_check";

-- Keep persisted clock coordinates physically valid even if a future write
-- path bypasses the request DTO and shared geofence guard.
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_clockIn_geography_check"
  CHECK (
    "clockInLat" BETWEEN -90 AND 90
    AND "clockInLng" BETWEEN -180 AND 180
    AND "clockInAccuracyM" >= 0
  ) NOT VALID;

ALTER TABLE "TimeEntry"
  VALIDATE CONSTRAINT "TimeEntry_clockIn_geography_check";

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_clockOut_geography_check"
  CHECK (
    (
      "clockOutLat" IS NULL
      AND "clockOutLng" IS NULL
      AND "clockOutAccuracyM" IS NULL
    )
    OR (
      "clockOutLat" IS NOT NULL
      AND
      "clockOutLat" BETWEEN -90 AND 90
      AND "clockOutLng" BETWEEN -180 AND 180
      AND "clockOutAccuracyM" >= 0
    )
  ) NOT VALID;

ALTER TABLE "TimeEntry"
  VALIDATE CONSTRAINT "TimeEntry_clockOut_geography_check";
