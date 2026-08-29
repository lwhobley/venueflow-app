-- VW-17 / product decision documented in the accompanying audit: retain
-- financial records past tenant offboarding rather than cascade-delete them,
-- matching the AuditLog (VW-16) and RetainedTimeEntry precedent. venueId
-- becomes nullable; no backfill needed since every existing row already has
-- a concrete value.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified.

ALTER TABLE "Invoice" ALTER COLUMN "venueId" DROP NOT NULL;

ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_venueId_fkey";
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
