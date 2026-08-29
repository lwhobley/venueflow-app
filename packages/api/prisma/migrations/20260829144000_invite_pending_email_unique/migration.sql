-- VW-25: nothing prevented multiple simultaneous pending invites for the
-- same email at one venue. Application code now supersedes (deletes) any
-- existing unused invite for the same (venueId, email) before creating a
-- new one (see app.controller.ts's createInvite and
-- workforce.controller.ts's inviteCheck), so this index should already be
-- satisfied by construction going forward — it is the database backstop.
--
-- Not scoped by expiresAt: a unique index predicate cannot reference now(),
-- so an old, expired, still-unused invite counts as "pending" here too.
-- That is exactly why the application-side supersede step above runs
-- unconditionally on every create, not only when a live redeemable invite
-- already exists.
--
-- This was authored without a live database connection available in this
-- session — the SQL below has not been execution-verified. Resolve any
-- existing duplicates before deploying (keep the most recent per pair):
--
--   SELECT "venueId", lower(email) AS email_lower, count(*)
--   FROM "Invite"
--   WHERE "usedBy" IS NULL AND email IS NOT NULL
--   GROUP BY "venueId", lower(email)
--   HAVING count(*) > 1;

DELETE FROM "Invite" i
WHERE i."usedBy" IS NULL
  AND i.email IS NOT NULL
  AND i.id NOT IN (
    SELECT DISTINCT ON ("venueId", lower(email)) id
    FROM "Invite"
    WHERE "usedBy" IS NULL AND email IS NOT NULL
    ORDER BY "venueId", lower(email), "createdAt" DESC
  );

CREATE UNIQUE INDEX "Invite_pending_email_key"
  ON "Invite" ("venueId", lower("email"))
  WHERE "usedBy" IS NULL AND "email" IS NOT NULL;
