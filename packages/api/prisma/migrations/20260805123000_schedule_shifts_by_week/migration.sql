-- Convert the former recurring weekly shift rows into concrete calendar weeks.
ALTER TABLE "ScheduleShift"
  ADD COLUMN IF NOT EXISTS "weekStart" TEXT;

UPDATE "ScheduleShift"
SET "weekStart" = (
  CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER
)::TEXT
WHERE "weekStart" IS NULL;

CREATE INDEX IF NOT EXISTS "ScheduleShift_venueId_weekStart_idx"
  ON "ScheduleShift"("venueId", "weekStart");
CREATE INDEX IF NOT EXISTS "ScheduleShift_venueId_profileId_weekStart_dayIndex_idx"
  ON "ScheduleShift"("venueId", "profileId", "weekStart", "dayIndex");

DROP INDEX IF EXISTS "ScheduleShift_venueId_profileId_dayIndex_idx";
