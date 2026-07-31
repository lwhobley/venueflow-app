-- CreateTable
CREATE TABLE "ChatImage" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatImage_venueId_idx" ON "ChatImage"("venueId");

-- AddForeignKey
ALTER TABLE "ChatImage" ADD CONSTRAINT "ChatImage_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
