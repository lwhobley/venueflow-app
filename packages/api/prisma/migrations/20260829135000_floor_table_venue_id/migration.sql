-- VW-09: FloorTable was the only floor model without its own venueId
-- (FloorPlan and FloorChair both have one), leaving it out of
-- VENUE_SCOPED_MODELS and the tenant-isolation Prisma extension's reach.
-- Every current call site already scopes through floorPlan.venueId or an
-- active-plan allowlist before touching a table (floor.service.ts), so this
-- closes a defense-in-depth gap rather than a live cross-tenant read.
--
-- Single migration, not a phased add-nullable/backfill/set-not-null
-- rollout: the backfill runs inside this same transaction, before any
-- application code (which only ships once this migration has already run —
-- see assert-migrations-current.mjs) ever sees the new column, so there is
-- no window where a write could land with a null venueId.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified.

ALTER TABLE "FloorTable" ADD COLUMN "venueId" TEXT;

UPDATE "FloorTable" t
SET "venueId" = p."venueId"
FROM "FloorPlan" p
WHERE t."floorPlanId" = p."id";

ALTER TABLE "FloorTable" ALTER COLUMN "venueId" SET NOT NULL;

ALTER TABLE "FloorTable"
  ADD CONSTRAINT "FloorTable_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FloorTable_venueId_idx" ON "FloorTable"("venueId");

-- VW-10 (partial): extend the tenant-reference trigger (defined in
-- 20260827013000_enforce_tenant_reference_integrity) to this newly-scoped
-- relation, so a raw-SQL or system-context write can't attach a table to a
-- floor plan in a different venue.
CREATE TRIGGER "FloorTable_floorPlan_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "floorPlanId" ON "FloorTable"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('floorPlanId', 'FloorPlan');
