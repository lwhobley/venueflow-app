-- Keep isOpen consistent with clockOutAt for open punches.
-- Open entries must not have a clock-out timestamp (otherwise the partial unique
-- index on isOpen=true can permanently block a second clock-in after a partial write).
-- Closed entries may still have a null clockOutAt (account-delete forced close).

-- Repair any drifted open rows before validating the constraint.
UPDATE "TimeEntry"
SET "isOpen" = false
WHERE "isOpen" = true
  AND "clockOutAt" IS NOT NULL;

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_open_state_check"
    CHECK (("isOpen" = true AND "clockOutAt" IS NULL) OR ("isOpen" = false)) NOT VALID;

ALTER TABLE "TimeEntry" VALIDATE CONSTRAINT "TimeEntry_open_state_check";
