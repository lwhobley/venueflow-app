-- VW-07 (database half): the application already clamps onHand at
-- Math.max(0, ...) before every write, so this should never fire in normal
-- operation. It exists as a backstop for any future write path that bypasses
-- that clamp (a script, an import job, a future endpoint).
--
-- Not expected to require a data audit — the existing app-level clamp means
-- no row should currently violate this — but VALIDATE CONSTRAINT still
-- full-scans the table, so confirm before deploying:
--
--   SELECT id, "venueId", "onHand" FROM "BarInventoryItem" WHERE "onHand" < 0;
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified.

ALTER TABLE "BarInventoryItem"
  ADD CONSTRAINT "BarInventoryItem_onHand_check"
    CHECK ("onHand" >= 0) NOT VALID;

ALTER TABLE "BarInventoryItem" VALIDATE CONSTRAINT "BarInventoryItem_onHand_check";
