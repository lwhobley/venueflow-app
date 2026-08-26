-- Every shift is a concrete calendar occurrence. Any rows written by legacy
-- clients after the original backfill are anchored to the week they were
-- created, then the invariant is enforced for future writes.
UPDATE "ScheduleShift"
SET "weekStart" = to_char(
  (("createdAt" AT TIME ZONE 'UTC')::date
    - EXTRACT(DOW FROM ("createdAt" AT TIME ZONE 'UTC'))::integer),
  'YYYY-MM-DD'
)
WHERE "weekStart" IS NULL;

ALTER TABLE "ScheduleShift"
ALTER COLUMN "weekStart" SET NOT NULL;
