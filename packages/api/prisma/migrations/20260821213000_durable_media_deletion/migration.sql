-- Attach uploaded chat images to their eventual message and add a durable S3
-- deletion outbox that survives tenant row deletion.
ALTER TABLE "ChatImage"
  ADD COLUMN "messageId" TEXT,
  ADD COLUMN "purgeStartedAt" TIMESTAMP(3);

-- Backfill at most one message for each legacy image path. Duplicate reuse was
-- never intended, so the oldest message becomes the owner and other messages
-- retain their display URL without claiming the image row.
WITH ranked AS (
  SELECT m."id" AS "messageId",
         substring(m."imageUrl" FROM '/v1/chat/images/([a-zA-Z0-9_-]+)') AS "imageId",
         row_number() OVER (
           PARTITION BY substring(m."imageUrl" FROM '/v1/chat/images/([a-zA-Z0-9_-]+)')
           ORDER BY m."createdAt", m."id"
         ) AS position
  FROM "Message" m
  WHERE m."imageUrl" ~ '^/v1/chat/images/[a-zA-Z0-9_-]+$'
)
UPDATE "ChatImage" image
SET "messageId" = ranked."messageId"
FROM ranked
WHERE ranked.position = 1 AND ranked."imageId" = image."id";

CREATE UNIQUE INDEX "ChatImage_messageId_key" ON "ChatImage"("messageId");
CREATE INDEX "ChatImage_messageId_createdAt_idx" ON "ChatImage"("messageId", "createdAt");
CREATE INDEX "ChatImage_purgeStartedAt_idx" ON "ChatImage"("purgeStartedAt");
ALTER TABLE "ChatImage" ADD CONSTRAINT "ChatImage_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ObjectDeletionJob" (
  "id" TEXT NOT NULL,
  "objectKeys" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ObjectDeletionJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ObjectDeletionJob_status_createdAt_idx" ON "ObjectDeletionJob"("status", "createdAt");
CREATE INDEX "ObjectDeletionJob_completedAt_idx" ON "ObjectDeletionJob"("completedAt");

-- The application is server-mediated; this queue must never be reachable via
-- Supabase's Data/GraphQL API roles.
ALTER TABLE "ObjectDeletionJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ObjectDeletionJob" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "ObjectDeletionJob" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
