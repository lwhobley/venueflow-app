-- AlterTable
ALTER TABLE "WorkplaceJoinRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Invite_phone_idx" ON "Invite"("phone");

-- CreateIndex
CREATE INDEX "Subscription_externalCustomerId_idx" ON "Subscription"("externalCustomerId");

-- CreateIndex
CREATE INDEX "TimeEntry_venueId_clockInAt_idx" ON "TimeEntry"("venueId", "clockInAt");

-- CreateIndex
CREATE INDEX "TimeEntry_isOpen_idx" ON "TimeEntry"("isOpen");

-- AddForeignKey
ALTER TABLE "TableState" ADD CONSTRAINT "TableState_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FloorTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableState" ADD CONSTRAINT "TableState_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarInventoryMovement" ADD CONSTRAINT "BarInventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BarInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "PosLaborPunch_venueId_provider_externalEmployeeId_businessDa_ke" RENAME TO "PosLaborPunch_venueId_provider_externalEmployeeId_businessD_key";
