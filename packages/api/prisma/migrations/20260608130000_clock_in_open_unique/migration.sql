-- Enforce at most one open time entry per profile.
-- First close any pre-existing duplicate open entries, keeping the most recent.
UPDATE "TimeEntry" t
SET "isOpen" = false
WHERE t."isOpen" = true
  AND EXISTS (
    SELECT 1 FROM "TimeEntry" o
    WHERE o."profileId" = t."profileId"
      AND o."isOpen" = true
      AND (o."clockInAt" > t."clockInAt"
           OR (o."clockInAt" = t."clockInAt" AND o."id" > t."id"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntry_profileId_open_key"
  ON "TimeEntry"("profileId")
  WHERE "isOpen" = true;
