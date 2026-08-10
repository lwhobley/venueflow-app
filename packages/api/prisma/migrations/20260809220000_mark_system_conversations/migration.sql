ALTER TABLE "Conversation"
ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Conversation"
SET "isSystem" = true
WHERE "type" IN ('role', 'shift');

WITH ranked_general_groups AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "venueId" ORDER BY "id") AS rank
  FROM "Conversation"
  WHERE "type" = 'group' AND "name" = 'All Staff'
)
UPDATE "Conversation" AS conversation
SET "isSystem" = true
FROM ranked_general_groups
WHERE conversation."id" = ranked_general_groups."id"
  AND ranked_general_groups.rank = 1;

CREATE UNIQUE INDEX "Conversation_one_system_group_per_venue_key"
ON "Conversation"("venueId")
WHERE "type" = 'group' AND "isSystem" = true;
