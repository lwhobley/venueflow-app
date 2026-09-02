-- VW-11: CrmNote.venueId had no FK, so nothing enforced it pointed at a
-- real venue and nothing cleaned these rows up when a venue was deleted.
-- Delete any orphans first — an orphaned note is already unreachable
-- through any tenant-scoped query (nothing can be bound to a venue that no
-- longer exists), so this discards dead rows, not live data.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified. Confirm the
-- orphan count is small/expected before deploying:
--
--   SELECT count(*) FROM "CrmNote" n
--   WHERE NOT EXISTS (SELECT 1 FROM "Venue" v WHERE v.id = n."venueId");

DELETE FROM "CrmNote" n
WHERE NOT EXISTS (SELECT 1 FROM "Venue" v WHERE v.id = n."venueId");

ALTER TABLE "CrmNote"
  ADD CONSTRAINT "CrmNote_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- VW-10 (partial): extend the tenant-reference trigger to this relation so
-- a raw-SQL write can't attach a note to a lead in a different venue.
CREATE TRIGGER "CrmNote_lead_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "leadId" ON "CrmNote"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('leadId', 'CrmLead');
