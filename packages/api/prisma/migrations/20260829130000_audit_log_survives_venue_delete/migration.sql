-- VW-16 / product decision documented in the accompanying audit: a deleted
-- venue's SOC2 audit trail is retained (venueId set to null), the same
-- policy already applied to wage records via RetainedTimeEntry. venueId was
-- already nullable, so this is a pure constraint change with no backfill.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified.

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_venueId_fkey";
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
