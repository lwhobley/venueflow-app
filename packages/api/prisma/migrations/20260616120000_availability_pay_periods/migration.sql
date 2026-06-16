-- Availability becomes dated per calendar week (weekStart). Existing rows are
-- the old recurring-weekly shape with no week, so they're incompatible — clear
-- them before adding the NOT NULL column. (Pre-launch: no production roster data
-- to preserve.)
DELETE FROM "Availability";

ALTER TABLE "Availability" ADD COLUMN "weekStart" TEXT NOT NULL;

-- Week-scoped lookups supersede the old (profileId, dayIndex) composite.
DROP INDEX IF EXISTS "Availability_profileId_dayIndex_idx";
CREATE INDEX "Availability_profileId_weekStart_idx" ON "Availability"("profileId", "weekStart");
CREATE INDEX "Availability_venueId_weekStart_idx" ON "Availability"("venueId", "weekStart");

-- Pay-period config + venue-wide availability unlock.
ALTER TABLE "Venue" ADD COLUMN "payPeriodAnchor" TEXT;
ALTER TABLE "Venue" ADD COLUMN "payPeriodLengthDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Venue" ADD COLUMN "availabilityUnlocked" BOOLEAN NOT NULL DEFAULT false;
