-- A session without a token hash cannot be bound to the bearer token that
-- created it. Preserve legacy rows as permanently unusable, unique sentinels
-- before making the security invariant mandatory.
UPDATE "Session"
SET "tokenHash" = 'invalid-unbound-session:' || "id"
WHERE "tokenHash" IS NULL;

ALTER TABLE "Session"
ALTER COLUMN "tokenHash" SET NOT NULL;
