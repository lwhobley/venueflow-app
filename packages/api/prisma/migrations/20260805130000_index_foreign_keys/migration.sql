-- Cover foreign keys used by relation lookups and cascading deletes.
-- IF NOT EXISTS keeps this migration safe if an environment was hot-fixed first.
CREATE INDEX IF NOT EXISTS "ScheduleMemoryNote_createdByProfileId_idx" ON "ScheduleMemoryNote"("createdByProfileId");
CREATE INDEX IF NOT EXISTS "Message_venueId_idx" ON "Message"("venueId");
CREATE INDEX IF NOT EXISTS "Message_shiftId_idx" ON "Message"("shiftId");
CREATE INDEX IF NOT EXISTS "Message_swapId_idx" ON "Message"("swapId");
CREATE INDEX IF NOT EXISTS "ConversationRead_profileId_idx" ON "ConversationRead"("profileId");
CREATE INDEX IF NOT EXISTS "VenueDocument_uploadedById_idx" ON "VenueDocument"("uploadedById");
CREATE INDEX IF NOT EXISTS "ShiftSwap_requesterShiftId_idx" ON "ShiftSwap"("requesterShiftId");
CREATE INDEX IF NOT EXISTS "ShiftSwap_targetShiftId_idx" ON "ShiftSwap"("targetShiftId");
CREATE INDEX IF NOT EXISTS "CrmLead_assignedToId_idx" ON "CrmLead"("assignedToId");
CREATE INDEX IF NOT EXISTS "CrmActivityLog_actorId_idx" ON "CrmActivityLog"("actorId");
CREATE INDEX IF NOT EXISTS "EventExecutionTask_workspaceId_venueId_idx" ON "EventExecutionTask"("workspaceId", "venueId");
CREATE INDEX IF NOT EXISTS "EventExecutionTimelineItem_workspaceId_venueId_idx" ON "EventExecutionTimelineItem"("workspaceId", "venueId");
CREATE INDEX IF NOT EXISTS "EventExecutionVendor_workspaceId_venueId_idx" ON "EventExecutionVendor"("workspaceId", "venueId");
CREATE INDEX IF NOT EXISTS "EventExecutionIncident_workspaceId_venueId_idx" ON "EventExecutionIncident"("workspaceId", "venueId");
CREATE INDEX IF NOT EXISTS "TableStateHistory_actorId_idx" ON "TableStateHistory"("actorId");
CREATE INDEX IF NOT EXISTS "WorkplaceJoinRequest_decidedById_idx" ON "WorkplaceJoinRequest"("decidedById");
CREATE INDEX IF NOT EXISTS "WorkplaceJoinRequestEvent_actorId_idx" ON "WorkplaceJoinRequestEvent"("actorId");
