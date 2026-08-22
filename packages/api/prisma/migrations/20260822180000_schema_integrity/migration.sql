-- Collapse duplicate Team rows before enforcing one team per venue.
-- Keep the highest memberCount, then the lexicographically greater id.
DELETE FROM "Team" AS a
USING "Team" AS b
WHERE a."venueId" = b."venueId"
  AND a."id" <> b."id"
  AND (
    a."memberCount" < b."memberCount"
    OR (a."memberCount" = b."memberCount" AND a."id" < b."id")
  );

DROP INDEX IF EXISTS "Team_venueId_idx";
CREATE UNIQUE INDEX "Team_venueId_key" ON "Team"("venueId");

CREATE INDEX "StaffRequest_requestedShiftId_idx" ON "StaffRequest"("requestedShiftId");
CREATE INDEX "StaffRequest_reviewerId_idx" ON "StaffRequest"("reviewerId");

-- Repair FloorChair.venueId from the parent floor plan, then add the FK.
UPDATE "FloorChair" AS chair
SET "venueId" = plan."venueId"
FROM "FloorPlan" AS plan
WHERE chair."floorPlanId" = plan."id"
  AND chair."venueId" IS DISTINCT FROM plan."venueId";

DELETE FROM "FloorChair"
WHERE "floorPlanId" NOT IN (SELECT "id" FROM "FloorPlan");

DELETE FROM "FloorChair"
WHERE "venueId" NOT IN (SELECT "id" FROM "Venue");

ALTER TABLE "FloorChair"
  ADD CONSTRAINT "FloorChair_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
