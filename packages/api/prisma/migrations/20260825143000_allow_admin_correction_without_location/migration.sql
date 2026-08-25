-- Administrative time corrections are manager-approved wage records, not
-- device punches. Represent the absence of a device fix explicitly instead
-- of persisting the fabricated coordinates 0,0 with zero accuracy.
ALTER TABLE "TimeEntry"
  ALTER COLUMN "clockInLat" DROP NOT NULL,
  ALTER COLUMN "clockInLng" DROP NOT NULL,
  ALTER COLUMN "clockInAccuracyM" DROP NOT NULL,
  ALTER COLUMN "clockInMocked" DROP NOT NULL;
