-- DropIndex
DROP INDEX IF EXISTS "ReservationSetting_venueId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSetting_venueId_key" ON "ReservationSetting"("venueId");
