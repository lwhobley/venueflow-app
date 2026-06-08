-- Add optional email binding for safer venue invitations.
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "email" TEXT;
CREATE INDEX IF NOT EXISTS "Invite_email_idx" ON "Invite"("email");

-- Remove duplicate RevenueCat events before enforcing webhook idempotency.
DELETE FROM "SubscriptionEvent" a
USING "SubscriptionEvent" b
WHERE a.id > b.id
  AND a.source = b.source
  AND a."externalEventId" = b."externalEventId";

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionEvent_source_externalEventId_key"
  ON "SubscriptionEvent"("source", "externalEventId");
