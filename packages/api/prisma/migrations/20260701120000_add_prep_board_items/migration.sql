CREATE TABLE "PrepBoardItem" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "station" TEXT,
    "notes" TEXT,
    "dueDate" TEXT,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepBoardItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PrepBoardItem"
ADD CONSTRAINT "PrepBoardItem_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PrepBoardItem_venueId_status_idx" ON "PrepBoardItem"("venueId", "status");
CREATE INDEX "PrepBoardItem_venueId_kind_idx" ON "PrepBoardItem"("venueId", "kind");
CREATE INDEX "PrepBoardItem_venueId_dueDate_idx" ON "PrepBoardItem"("venueId", "dueDate");
