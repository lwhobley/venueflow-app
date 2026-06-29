-- Add defense-in-depth foreign keys for string id references that previously
-- relied only on controller discipline. NOT VALID avoids a long blocking table
-- scan during deploy; future writes are still checked, and constraints can be
-- validated in a later maintenance window after any legacy drift is cleaned.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_venueId_fkey') THEN
    ALTER TABLE "Message" ADD CONSTRAINT "Message_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_shiftId_fkey') THEN
    ALTER TABLE "Message" ADD CONSTRAINT "Message_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ScheduleShift"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_swapId_fkey') THEN
    ALTER TABLE "Message" ADD CONSTRAINT "Message_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "ShiftSwap"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationRead_profileId_fkey') THEN
    ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationEvent_profileId_fkey') THEN
    ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationRead_notificationId_fkey') THEN
    ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationRead_profileId_fkey') THEN
    ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftSwap_requesterProfileId_fkey') THEN
    ALTER TABLE "ShiftSwap" ADD CONSTRAINT "ShiftSwap_requesterProfileId_fkey" FOREIGN KEY ("requesterProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftSwap_targetProfileId_fkey') THEN
    ALTER TABLE "ShiftSwap" ADD CONSTRAINT "ShiftSwap_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftSwap_requesterShiftId_fkey') THEN
    ALTER TABLE "ShiftSwap" ADD CONSTRAINT "ShiftSwap_requesterShiftId_fkey" FOREIGN KEY ("requesterShiftId") REFERENCES "ScheduleShift"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftSwap_targetShiftId_fkey') THEN
    ALTER TABLE "ShiftSwap" ADD CONSTRAINT "ShiftSwap_targetShiftId_fkey" FOREIGN KEY ("targetShiftId") REFERENCES "ScheduleShift"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TableAssignment_tableId_fkey') THEN
    ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FloorTable"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TableAssignment_waitlistId_fkey') THEN
    ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_waitlistId_fkey" FOREIGN KEY ("waitlistId") REFERENCES "Waitlist"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CrmActivityLog_leadId_fkey') THEN
    ALTER TABLE "CrmActivityLog" ADD CONSTRAINT "CrmActivityLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CrmActivityLog_actorId_fkey') THEN
    ALTER TABLE "CrmActivityLog" ADD CONSTRAINT "CrmActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TableStateHistory_tableId_fkey') THEN
    ALTER TABLE "TableStateHistory" ADD CONSTRAINT "TableStateHistory_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FloorTable"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TableStateHistory_actorId_fkey') THEN
    ALTER TABLE "TableStateHistory" ADD CONSTRAINT "TableStateHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkplaceJoinRequest_decidedById_fkey') THEN
    ALTER TABLE "WorkplaceJoinRequest" ADD CONSTRAINT "WorkplaceJoinRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkplaceJoinRequestEvent_actorId_fkey') THEN
    ALTER TABLE "WorkplaceJoinRequestEvent" ADD CONSTRAINT "WorkplaceJoinRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
