-- Enforce the uniqueness declared by CrmContract.contractNumber.
CREATE UNIQUE INDEX "CrmContract_contractNumber_key"
  ON "CrmContract"("contractNumber");

-- These foreign keys were added NOT VALID to avoid blocking their original
-- deploy. Validate existing rows now that the relations are represented in
-- schema.prisma as well.
ALTER TABLE "Message" VALIDATE CONSTRAINT "Message_venueId_fkey";
ALTER TABLE "Message" VALIDATE CONSTRAINT "Message_shiftId_fkey";
ALTER TABLE "Message" VALIDATE CONSTRAINT "Message_swapId_fkey";
ALTER TABLE "ConversationRead" VALIDATE CONSTRAINT "ConversationRead_profileId_fkey";
ALTER TABLE "NotificationEvent" VALIDATE CONSTRAINT "NotificationEvent_profileId_fkey";
ALTER TABLE "NotificationRead" VALIDATE CONSTRAINT "NotificationRead_notificationId_fkey";
ALTER TABLE "NotificationRead" VALIDATE CONSTRAINT "NotificationRead_profileId_fkey";
ALTER TABLE "ShiftSwap" VALIDATE CONSTRAINT "ShiftSwap_requesterProfileId_fkey";
ALTER TABLE "ShiftSwap" VALIDATE CONSTRAINT "ShiftSwap_targetProfileId_fkey";
ALTER TABLE "ShiftSwap" VALIDATE CONSTRAINT "ShiftSwap_requesterShiftId_fkey";
ALTER TABLE "ShiftSwap" VALIDATE CONSTRAINT "ShiftSwap_targetShiftId_fkey";
ALTER TABLE "TableAssignment" VALIDATE CONSTRAINT "TableAssignment_tableId_fkey";
ALTER TABLE "TableAssignment" VALIDATE CONSTRAINT "TableAssignment_waitlistId_fkey";
ALTER TABLE "CrmActivityLog" VALIDATE CONSTRAINT "CrmActivityLog_leadId_fkey";
ALTER TABLE "CrmActivityLog" VALIDATE CONSTRAINT "CrmActivityLog_actorId_fkey";
ALTER TABLE "TableStateHistory" VALIDATE CONSTRAINT "TableStateHistory_tableId_fkey";
ALTER TABLE "TableStateHistory" VALIDATE CONSTRAINT "TableStateHistory_actorId_fkey";
ALTER TABLE "WorkplaceJoinRequest" VALIDATE CONSTRAINT "WorkplaceJoinRequest_decidedById_fkey";
ALTER TABLE "WorkplaceJoinRequestEvent" VALIDATE CONSTRAINT "WorkplaceJoinRequestEvent_actorId_fkey";
