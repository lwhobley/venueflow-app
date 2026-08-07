-- Review-residual hardening:
-- 1. One Availability row per profile/week/day (the app upserts per day).
-- 2. NotificationEvent.profileId -> SetNull so deleting a profile cannot erase
--    venue-wide notification history other staff already received.

-- Fail without modifying data if an existing environment violates the
-- invariant. The application already treats this key as unique.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Availability" GROUP BY "profileId", "weekStart", "dayIndex" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce availability uniqueness: duplicate Availability (profileId, weekStart, dayIndex) rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "Availability_profileId_weekStart_dayIndex_key"
  ON "Availability"("profileId", "weekStart", "dayIndex");

ALTER TABLE "NotificationEvent" DROP CONSTRAINT "NotificationEvent_profileId_fkey";
ALTER TABLE "NotificationEvent"
  ADD CONSTRAINT "NotificationEvent_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "Profile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
