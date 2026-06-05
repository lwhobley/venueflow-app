-- CreateTable
CREATE TABLE "ShiftSwap" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "requesterProfileId" TEXT NOT NULL,
    "requesterShiftId" TEXT NOT NULL,
    "targetProfileId" TEXT NOT NULL,
    "targetShiftId" TEXT,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftSwap_venueId_idx" ON "ShiftSwap"("venueId");

-- CreateIndex
CREATE INDEX "ShiftSwap_requesterProfileId_idx" ON "ShiftSwap"("requesterProfileId");

-- CreateIndex
CREATE INDEX "ShiftSwap_targetProfileId_idx" ON "ShiftSwap"("targetProfileId");

-- AddForeignKey
ALTER TABLE "ShiftSwap" ADD CONSTRAINT "ShiftSwap_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
