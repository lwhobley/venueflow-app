-- VW-02: the app-level 24-hour overnight cap accepted a transposed pair of
-- shift times (e.g. 22:00 start / 21:00 end) as a legitimate 23-hour shift,
-- because the client submits both times as raw clock minutes and cannot
-- distinguish "crosses midnight" from "typo" any other way. Tightening the
-- app validator to 16 hours without a matching database constraint would
-- leave this CHECK as the last line of defense against any future write
-- path that bypasses ensureValidShiftWindow.
--
-- MANUAL STEP REQUIRED BEFORE DEPLOYING THIS MIGRATION:
-- Run the following against production first and resolve any rows returned.
-- Validating a NOT VALID constraint full-scans the table and will fail
-- outright if any existing row violates it:
--
--   SELECT id, "venueId", "profileId", "weekStart", "dayIndex",
--          "startMinutes", "endMinutes", "endMinutes" - "startMinutes" AS duration_minutes
--   FROM "ScheduleShift"
--   WHERE "endMinutes" - "startMinutes" > 960;
--
-- This was authored without a live database connection available in this
-- session (see prisma/README or the accompanying audit) — the SQL below
-- has not been execution-verified. Test it against a copy of the schema
-- before running `prisma migrate deploy` in any real environment.

ALTER TABLE "ScheduleShift" DROP CONSTRAINT IF EXISTS "ScheduleShift_time_window_check";
ALTER TABLE "ScheduleShift"
  ADD CONSTRAINT "ScheduleShift_time_window_check"
    CHECK (
      "dayIndex" BETWEEN 0 AND 6
      AND "startMinutes" BETWEEN 0 AND 1439
      AND "endMinutes" BETWEEN 1 AND 2880
      AND "endMinutes" > "startMinutes"
      AND "endMinutes" - "startMinutes" <= 960
    ) NOT VALID;

ALTER TABLE "ScheduleShift" VALIDATE CONSTRAINT "ScheduleShift_time_window_check";
