-- Schedule memory lets managers record what the scheduler should remember next time.
CREATE TABLE "ScheduleMemoryNote" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdByProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleMemoryNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduleMemoryNote_venueId_idx" ON "ScheduleMemoryNote"("venueId");
CREATE INDEX "ScheduleMemoryNote_venueId_weekStart_idx" ON "ScheduleMemoryNote"("venueId", "weekStart");
CREATE INDEX "ScheduleMemoryNote_venueId_createdAt_idx" ON "ScheduleMemoryNote"("venueId", "createdAt");

ALTER TABLE "ScheduleMemoryNote"
ADD CONSTRAINT "ScheduleMemoryNote_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduleMemoryNote"
ADD CONSTRAINT "ScheduleMemoryNote_createdByProfileId_fkey"
FOREIGN KEY ("createdByProfileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
