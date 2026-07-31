-- Add proper Venue FKs to CrmBeo and CrmContract. Previously these tables
-- stored venueId without a foreign key, so deleting a venue left orphan rows.
-- Clean up any pre-existing orphans before adding the constraints.

DELETE FROM "CrmBeo" WHERE "venueId" NOT IN (SELECT "id" FROM "Venue");
DELETE FROM "CrmContract" WHERE "venueId" NOT IN (SELECT "id" FROM "Venue");

ALTER TABLE "CrmBeo"
  ADD CONSTRAINT "CrmBeo_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmContract"
  ADD CONSTRAINT "CrmContract_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
