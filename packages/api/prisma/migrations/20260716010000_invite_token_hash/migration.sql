-- Invite bearer tokens are single-use, 7-day-lived account-creation +
-- venue-membership credentials. Unlike Session (which already stores only
-- tokenHash), Invite.token was stored in plaintext — a DB dump/backup leak
-- or a read-only SQL injection would hand over usable signup links for
-- every pending invite. This migration switches Invite to the same
-- hash-only-at-rest pattern already used for Session.

-- Add the new hashed column (nullable for the backfill step below).
ALTER TABLE "Invite" ADD COLUMN "tokenHash" TEXT;

-- Backfill: hash any existing plaintext token so already-pending invites
-- remain redeemable once the plaintext column is dropped.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE "Invite" SET "tokenHash" = encode(digest("token", 'sha256'), 'hex');

-- Every row now has a hash; enforce NOT NULL + uniqueness (mirrors the old
-- token column's constraints).
ALTER TABLE "Invite" ALTER COLUMN "tokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- Drop the plaintext column and its now-redundant unique index.
DROP INDEX "Invite_token_key";
ALTER TABLE "Invite" DROP COLUMN "token";
