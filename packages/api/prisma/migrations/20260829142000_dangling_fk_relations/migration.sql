-- VW-12: several scalar id columns carried no FK at all — a mix of
-- required (ScheduleEmailEvent.profileId, StaffOnboardingTask.profileId)
-- and nullable (CrmLead.guestId, CrmContract.beoId,
-- StaffRequest.requestedShiftId, StaffRequest.reviewerId) references.
-- PosCheck.guestId/serverId/tableId were considered and deliberately
-- excluded: those are opaque external POS-system identifiers paired with
-- denormalized display strings (guestName/serverName/tableLabel), not
-- references into this app's own Guest/Profile/FloorTable rows — adding an
-- internal FK there would be actively wrong, not merely missing.
--
-- Nullable columns: orphans are set to NULL rather than deleted, since the
-- parent row (a CRM lead, a staff request) is still a real, meaningful
-- record on its own. Required columns: orphans are deleted, since an
-- onboarding task or email-event log entry for a profile that no longer
-- exists has no independent meaning.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified. Confirm orphan
-- counts are small/expected before deploying (swap the UPDATE/DELETE below
-- for a SELECT count(*) first).

UPDATE "CrmLead" l SET "guestId" = NULL
WHERE l."guestId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Guest" g WHERE g.id = l."guestId");

UPDATE "CrmContract" c SET "beoId" = NULL
WHERE c."beoId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CrmBeo" b WHERE b.id = c."beoId");

UPDATE "StaffRequest" r SET "requestedShiftId" = NULL
WHERE r."requestedShiftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ScheduleShift" s WHERE s.id = r."requestedShiftId");

UPDATE "StaffRequest" r SET "reviewerId" = NULL
WHERE r."reviewerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Profile" p WHERE p.id = r."reviewerId");

DELETE FROM "ScheduleEmailEvent" e
WHERE NOT EXISTS (SELECT 1 FROM "Profile" p WHERE p.id = e."profileId");

DELETE FROM "StaffOnboardingTask" t
WHERE NOT EXISTS (SELECT 1 FROM "Profile" p WHERE p.id = t."profileId");

ALTER TABLE "CrmLead"
  ADD CONSTRAINT "CrmLead_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmContract"
  ADD CONSTRAINT "CrmContract_beoId_fkey"
    FOREIGN KEY ("beoId") REFERENCES "CrmBeo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffRequest"
  ADD CONSTRAINT "StaffRequest_requestedShiftId_fkey"
    FOREIGN KEY ("requestedShiftId") REFERENCES "ScheduleShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffRequest"
  ADD CONSTRAINT "StaffRequest_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScheduleEmailEvent"
  ADD CONSTRAINT "ScheduleEmailEvent_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffOnboardingTask"
  ADD CONSTRAINT "StaffOnboardingTask_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
