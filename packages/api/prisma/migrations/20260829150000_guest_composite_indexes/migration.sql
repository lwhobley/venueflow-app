-- VW-14: replace the global single-column phone/email indexes with
-- venue-composite ones — every Guest lookup is already tenant-scoped, so
-- the old indexes made Postgres filter a cross-tenant result set instead of
-- seeking directly.
--
-- VW-18 applies here: on a Guest table large enough for this to matter,
-- building these with a plain CREATE INDEX takes a write lock for the
-- duration. Prisma migrations run inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside one — so on a large production
-- table, run the two CREATE INDEX CONCURRENTLY statements below by hand
-- against the direct connection first, then let this migration's DROP/CREATE
-- pair run as a fast no-op (the CONCURRENTLY-built index already exists
-- under the same name). This was authored without a live database
-- connection available in this session and has not been execution-verified.
--
--   CREATE INDEX CONCURRENTLY "Guest_venueId_phone_idx" ON "Guest" ("venueId", "phone");
--   CREATE INDEX CONCURRENTLY "Guest_venueId_email_idx" ON "Guest" ("venueId", "email");

DROP INDEX IF EXISTS "Guest_phone_idx";
DROP INDEX IF EXISTS "Guest_email_idx";

CREATE INDEX IF NOT EXISTS "Guest_venueId_phone_idx" ON "Guest"("venueId", "phone");
CREATE INDEX IF NOT EXISTS "Guest_venueId_email_idx" ON "Guest"("venueId", "email");
