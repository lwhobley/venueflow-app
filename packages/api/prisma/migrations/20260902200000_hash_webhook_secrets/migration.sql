-- Hash any legacy plaintext webhook secrets at rest using SHA-256.
-- PosConnection, ReservationConnection, and Venue already support sha256: prefixed secrets
-- via secretsMatch() in common/webhook-auth.ts.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

UPDATE "PosConnection"
SET "webhookSecret" = 'sha256:' || encode(extensions.digest("webhookSecret"::bytea, 'sha256'), 'hex')
WHERE "webhookSecret" IS NOT NULL
  AND "webhookSecret" NOT LIKE 'sha256:%';

UPDATE "ReservationConnection"
SET "webhookSecret" = 'sha256:' || encode(extensions.digest("webhookSecret"::bytea, 'sha256'), 'hex')
WHERE "webhookSecret" IS NOT NULL
  AND "webhookSecret" NOT LIKE 'sha256:%';

UPDATE "Venue"
SET "leadsWebhookSecret" = 'sha256:' || encode(extensions.digest("leadsWebhookSecret"::bytea, 'sha256'), 'hex')
WHERE "leadsWebhookSecret" IS NOT NULL
  AND "leadsWebhookSecret" NOT LIKE 'sha256:%';
