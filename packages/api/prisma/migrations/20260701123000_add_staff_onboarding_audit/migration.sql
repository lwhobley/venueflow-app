CREATE TABLE "StaffOnboardingTask" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "category" TEXT NOT NULL,
    "dueDate" TEXT,
    "status" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffOnboardingTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "actorProfileId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "targetProfileId" TEXT,
    "targetName" TEXT,
    "targetRole" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StaffOnboardingTask"
ADD CONSTRAINT "StaffOnboardingTask_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "StaffOnboardingTask_profileId_title_key" ON "StaffOnboardingTask"("profileId", "title");
CREATE INDEX "StaffOnboardingTask_venueId_profileId_idx" ON "StaffOnboardingTask"("venueId", "profileId");
CREATE INDEX "StaffOnboardingTask_venueId_status_idx" ON "StaffOnboardingTask"("venueId", "status");
CREATE INDEX "AuditLog_venueId_createdAt_idx" ON "AuditLog"("venueId", "createdAt");
CREATE INDEX "AuditLog_venueId_action_idx" ON "AuditLog"("venueId", "action");
CREATE INDEX "AuditLog_targetProfileId_idx" ON "AuditLog"("targetProfileId");
