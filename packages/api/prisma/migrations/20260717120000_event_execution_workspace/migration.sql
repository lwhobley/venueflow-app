CREATE TABLE "EventExecutionWorkspace" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'blocked',
    "readiness" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventExecutionWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventExecutionTask" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ownerId" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventExecutionTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventExecutionTimelineItem" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventExecutionTimelineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventExecutionVendor" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unconfirmed',
    "ownerId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventExecutionVendor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventExecutionIncident" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'high',
    "status" TEXT NOT NULL DEFAULT 'open',
    "blocksReadiness" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventExecutionIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventExecutionWorkspace_venueId_sourceType_sourceId_key" ON "EventExecutionWorkspace"("venueId", "sourceType", "sourceId");
CREATE INDEX "EventExecutionWorkspace_venueId_status_idx" ON "EventExecutionWorkspace"("venueId", "status");
CREATE INDEX "EventExecutionWorkspace_venueId_updatedAt_idx" ON "EventExecutionWorkspace"("venueId", "updatedAt");
CREATE INDEX "EventExecutionTask_venueId_workspaceId_status_idx" ON "EventExecutionTask"("venueId", "workspaceId", "status");
CREATE INDEX "EventExecutionTask_venueId_dueAt_idx" ON "EventExecutionTask"("venueId", "dueAt");
CREATE INDEX "EventExecutionTimelineItem_venueId_workspaceId_startsAt_idx" ON "EventExecutionTimelineItem"("venueId", "workspaceId", "startsAt");
CREATE INDEX "EventExecutionVendor_venueId_workspaceId_status_idx" ON "EventExecutionVendor"("venueId", "workspaceId", "status");
CREATE INDEX "EventExecutionIncident_venueId_workspaceId_status_idx" ON "EventExecutionIncident"("venueId", "workspaceId", "status");

ALTER TABLE "EventExecutionTask" ADD CONSTRAINT "EventExecutionTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "EventExecutionWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionTimelineItem" ADD CONSTRAINT "EventExecutionTimelineItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "EventExecutionWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionVendor" ADD CONSTRAINT "EventExecutionVendor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "EventExecutionWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExecutionIncident" ADD CONSTRAINT "EventExecutionIncident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "EventExecutionWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
