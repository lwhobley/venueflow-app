-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('sop', 'manual', 'recipe', 'menu', 'training', 'form', 'other');

-- CreateTable
CREATE TABLE "VenueDocument" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueDocument_s3Key_key" ON "VenueDocument"("s3Key");
CREATE INDEX "VenueDocument_venueId_createdAt_idx" ON "VenueDocument"("venueId", "createdAt");
CREATE INDEX "VenueDocument_venueId_category_idx" ON "VenueDocument"("venueId", "category");

ALTER TABLE "VenueDocument" ADD CONSTRAINT "VenueDocument_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueDocument" ADD CONSTRAINT "VenueDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
