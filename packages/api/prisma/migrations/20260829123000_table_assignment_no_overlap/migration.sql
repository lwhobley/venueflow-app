-- VW-04 (table half): assignReservationToTables and assignWaitlistToTables
-- already check for an overlapping active TableAssignment on the requested
-- table inside a Serializable transaction before inserting
-- (floor.service.ts), so this constraint should never fire in normal
-- operation. It exists as a database-level backstop for any future write
-- path that creates a TableAssignment without going through that service.
--
-- MANUAL STEP REQUIRED BEFORE DEPLOYING THIS MIGRATION:
-- The initial index build for an EXCLUDE constraint scans the existing
-- table and fails outright on any violation. Run this first and resolve
-- any rows returned:
--
--   SELECT a.id AS assignment_a, b.id AS assignment_b, a."tableId"
--   FROM "TableAssignment" a
--   JOIN "TableAssignment" b
--     ON a."tableId" = b."tableId"
--    AND a.id < b.id
--    AND a."releasedAt" IS NULL AND b."releasedAt" IS NULL
--    AND tstzrange(a."startsAt", a."endsAt") && tstzrange(b."startsAt", b."endsAt");
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified. Test it against
-- a copy of the schema before running `prisma migrate deploy` anywhere real.

-- Installed into `extensions`, not `public` — see the identical comment in
-- 20260829121500_time_entry_order_and_overlap, which installs this first.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- tsrange, not tstzrange: startsAt/endsAt are `timestamp without time zone`
-- (Prisma's default DateTime mapping) — confirmed against the live schema
-- after TimeEntry's identical constraint hit 42P17 with tstzrange.
ALTER TABLE "TableAssignment"
  ADD CONSTRAINT "TableAssignment_no_overlap_excl"
    EXCLUDE USING gist (
      "tableId" WITH =,
      tsrange("startsAt", "endsAt") WITH &&
    ) WHERE ("releasedAt" IS NULL);
