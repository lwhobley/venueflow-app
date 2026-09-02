-- A punch whose coordinates exactly repeat an earlier day's fix used to be
-- rejected outright. Indoors that is normal behaviour for Wi-Fi/cell
-- positioning, which returns a deterministic value, so genuine employees at
-- venues without a satellite fix were locked out of the time clock with no
-- self-service recovery. The signal is still worth keeping, so it is now
-- recorded here for manager review instead of blocking the punch.
ALTER TABLE "TimeEntry" ADD COLUMN "locationAnomaly" TEXT;

-- Partial index: the manager clock board only ever asks for the flagged rows,
-- which are a small minority of a venue's punches.
CREATE INDEX "TimeEntry_venueId_locationAnomaly_idx"
  ON "TimeEntry" ("venueId", "clockInAt" DESC)
  WHERE "locationAnomaly" IS NOT NULL;
