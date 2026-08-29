-- VW-03: no existing constraint stops a closed TimeEntry from having
-- clockOutAt <= clockInAt, and no constraint stops two closed punches for the
-- same profile from overlapping. Submission-time app validation covers the
-- employee's initial request only; the manager-approval path can still
-- rewrite either field (see the accompanying application fix in
-- staff-requests.controller.ts, which now re-checks both at approval time —
-- this migration makes both invariants unconditional at the database layer).
--
-- MANUAL STEPS REQUIRED BEFORE DEPLOYING THIS MIGRATION:
-- Run both queries against production first and resolve any rows returned.
-- VALIDATE CONSTRAINT full-scans the table and fails outright on a
-- violation; the EXCLUDE constraint's initial index build will likewise
-- fail if any two closed rows for one profile currently overlap.
--
--   -- Inverted or zero-length punches:
--   SELECT id, "profileId", "clockInAt", "clockOutAt"
--   FROM "TimeEntry"
--   WHERE "clockOutAt" IS NOT NULL AND "clockOutAt" <= "clockInAt";
--
--   -- Overlapping closed punches for the same profile:
--   SELECT a.id AS entry_a, b.id AS entry_b, a."profileId"
--   FROM "TimeEntry" a
--   JOIN "TimeEntry" b
--     ON a."profileId" = b."profileId"
--    AND a.id < b.id
--    AND a."clockOutAt" IS NOT NULL AND b."clockOutAt" IS NOT NULL
--    AND tstzrange(a."clockInAt", a."clockOutAt") && tstzrange(b."clockInAt", b."clockOutAt")
--   WHERE a."profileId" IS NOT NULL;
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified. Test it against
-- a copy of the schema before running `prisma migrate deploy` anywhere real.

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_clock_order_check"
    CHECK ("clockOutAt" IS NULL OR "clockOutAt" > "clockInAt") NOT VALID;

ALTER TABLE "TimeEntry" VALIDATE CONSTRAINT "TimeEntry_clock_order_check";

-- Required for the GiST exclusion constraint below: it mixes an equality
-- comparison on "profileId" with a range-overlap comparison, which plain
-- GiST only supports once btree_gist supplies the equality operator class.
-- Installed into `extensions`, not `public` — Supabase's own convention,
-- and its security linter flags an extension left in public (confirmed via
-- get_advisors after this ran with the default schema on first deploy).
-- CREATE SCHEMA IF NOT EXISTS first: Supabase provisions `extensions` by
-- default, but a plain Postgres instance (e.g. CI's test container) does
-- not — confirmed by CI failing on this exact line with "schema
-- \"extensions\" does not exist" against a fresh, non-Supabase database.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Only closed punches with a known profile participate. An open punch
-- (clockOutAt IS NULL) is already governed by the existing
-- TimeEntry_profileId_open_key partial unique index (one open punch per
-- profile at a time), and a null profileId belongs to a retained/orphaned
-- record that no longer identifies a specific employee to overlap against.
--
-- tsrange, not tstzrange: clockInAt/clockOutAt are `timestamp without time
-- zone` (Prisma's default DateTime mapping). tstzrange would implicitly
-- cast through the session TimeZone setting, which is STABLE, not
-- IMMUTABLE, and Postgres rejects a non-immutable expression in an index —
-- confirmed against the live schema (42P17) before landing on tsrange.
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_no_overlap_excl"
    EXCLUDE USING gist (
      "profileId" WITH =,
      tsrange("clockInAt", "clockOutAt") WITH &&
    ) WHERE ("clockOutAt" IS NOT NULL AND "profileId" IS NOT NULL);
