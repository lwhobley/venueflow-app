CREATE TABLE "LogbookEntry" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "authorProfileId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogbookEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistCompletion" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "photoKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistCompletion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LogbookEntry"
ADD CONSTRAINT "LogbookEntry_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistTemplateItem"
ADD CONSTRAINT "ChecklistTemplateItem_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistCompletion"
ADD CONSTRAINT "ChecklistCompletion_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistCompletion"
ADD CONSTRAINT "ChecklistCompletion_templateItemId_fkey"
FOREIGN KEY ("templateItemId") REFERENCES "ChecklistTemplateItem"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "LogbookEntry_venueId_createdAt_idx" ON "LogbookEntry"("venueId", "createdAt");
CREATE INDEX "LogbookEntry_venueId_pinned_idx" ON "LogbookEntry"("venueId", "pinned");
CREATE INDEX "ChecklistTemplateItem_venueId_kind_active_idx" ON "ChecklistTemplateItem"("venueId", "kind", "active");
CREATE UNIQUE INDEX "ChecklistCompletion_templateItemId_date_key" ON "ChecklistCompletion"("templateItemId", "date");
CREATE INDEX "ChecklistCompletion_venueId_date_idx" ON "ChecklistCompletion"("venueId", "date");
