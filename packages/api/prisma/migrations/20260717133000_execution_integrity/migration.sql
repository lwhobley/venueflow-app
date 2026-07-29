DELETE FROM "EventExecutionVendor" WHERE "name" = 'Event vendors / production';
DELETE FROM "PrepBoardItem" WHERE "kind" = 'event_execution' AND "notes" LIKE '%execution:%';

ALTER TABLE "EventExecutionWorkspace" DROP COLUMN "status", DROP COLUMN "readiness";

ALTER TABLE "EventExecutionTask" ADD COLUMN "templateKey" TEXT;
ALTER TABLE "EventExecutionTimelineItem" ADD COLUMN "templateKey" TEXT;
ALTER TABLE "EventExecutionVendor" ADD COLUMN "templateKey" TEXT;

UPDATE "EventExecutionTask" SET "templateKey" = 'legacy-' || "id" WHERE "templateKey" IS NULL;
UPDATE "EventExecutionTimelineItem" SET "templateKey" = 'legacy-' || "id" WHERE "templateKey" IS NULL;
UPDATE "EventExecutionVendor" SET "templateKey" = 'legacy-' || "id" WHERE "templateKey" IS NULL;

ALTER TABLE "EventExecutionTask" ALTER COLUMN "templateKey" SET NOT NULL;
ALTER TABLE "EventExecutionTimelineItem" ALTER COLUMN "templateKey" SET NOT NULL;
ALTER TABLE "EventExecutionVendor" ALTER COLUMN "templateKey" SET NOT NULL;

CREATE UNIQUE INDEX "EventExecutionWorkspace_id_venueId_key" ON "EventExecutionWorkspace"("id", "venueId");
CREATE UNIQUE INDEX "EventExecutionTask_workspaceId_templateKey_key" ON "EventExecutionTask"("workspaceId", "templateKey");
CREATE UNIQUE INDEX "EventExecutionTimelineItem_workspaceId_templateKey_key" ON "EventExecutionTimelineItem"("workspaceId", "templateKey");
CREATE UNIQUE INDEX "EventExecutionVendor_workspaceId_templateKey_key" ON "EventExecutionVendor"("workspaceId", "templateKey");

DROP INDEX IF EXISTS "EventExecutionWorkspace_venueId_status_idx";

ALTER TABLE "EventExecutionTask" DROP CONSTRAINT IF EXISTS "EventExecutionTask_workspaceId_fkey";
ALTER TABLE "EventExecutionTimelineItem" DROP CONSTRAINT IF EXISTS "EventExecutionTimelineItem_workspaceId_fkey";
ALTER TABLE "EventExecutionVendor" DROP CONSTRAINT IF EXISTS "EventExecutionVendor_workspaceId_fkey";
ALTER TABLE "EventExecutionIncident" DROP CONSTRAINT IF EXISTS "EventExecutionIncident_workspaceId_fkey";

ALTER TABLE "EventExecutionWorkspace" ADD CONSTRAINT "EventExecutionWorkspace_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionTask" ADD CONSTRAINT "EventExecutionTask_workspaceId_venueId_fkey" FOREIGN KEY ("workspaceId", "venueId") REFERENCES "EventExecutionWorkspace"("id", "venueId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionTimelineItem" ADD CONSTRAINT "EventExecutionTimelineItem_workspaceId_venueId_fkey" FOREIGN KEY ("workspaceId", "venueId") REFERENCES "EventExecutionWorkspace"("id", "venueId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionVendor" ADD CONSTRAINT "EventExecutionVendor_workspaceId_venueId_fkey" FOREIGN KEY ("workspaceId", "venueId") REFERENCES "EventExecutionWorkspace"("id", "venueId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionIncident" ADD CONSTRAINT "EventExecutionIncident_workspaceId_venueId_fkey" FOREIGN KEY ("workspaceId", "venueId") REFERENCES "EventExecutionWorkspace"("id", "venueId") ON DELETE CASCADE ON UPDATE CASCADE;
