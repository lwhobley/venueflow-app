-- Availability becomes dated per calendar week (weekStart). Existing recurring
-- rows are backfilled to the current Sunday so the NOT NULL column can be added
-- without discarding staff-entered availability.
ALTER TABLE "Availability" ADD COLUMN "weekStart" TEXT;

UPDATE "Availability"
SET "weekStart" = to_char((CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)::date, 'YYYY-MM-DD')
WHERE "weekStart" IS NULL;

ALTER TABLE "Availability" ALTER COLUMN "weekStart" SET NOT NULL;

-- Week-scoped lookups supersede the old (profileId, dayIndex) composite.
DROP INDEX IF EXISTS "Availability_profileId_dayIndex_idx";
CREATE INDEX "Availability_profileId_weekStart_idx" ON "Availability"("profileId", "weekStart");
CREATE INDEX "Availability_venueId_weekStart_idx" ON "Availability"("venueId", "weekStart");

-- Pay-period config + venue-wide availability unlock.
ALTER TABLE "Venue" ADD COLUMN "payPeriodAnchor" TEXT;
ALTER TABLE "Venue" ADD COLUMN "payPeriodLengthDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Venue" ADD COLUMN "availabilityUnlocked" BOOLEAN NOT NULL DEFAULT false;
