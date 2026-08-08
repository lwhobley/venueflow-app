CREATE TABLE "AiUsageEvent" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "profileId" TEXT,
  "feature" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "cachedTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsageEvent_venueId_createdAt_idx" ON "AiUsageEvent"("venueId", "createdAt");
CREATE INDEX "AiUsageEvent_venueId_feature_createdAt_idx" ON "AiUsageEvent"("venueId", "feature", "createdAt");
CREATE INDEX "AiUsageEvent_profileId_createdAt_idx" ON "AiUsageEvent"("profileId", "createdAt");

ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
