-- Prevent duplicate venueless Profile rows per user.
--
-- app.controller.ts's bootstrap-profile endpoint does an unguarded
-- findFirst-then-create with no transaction or lock: two concurrent calls
-- (a client retry, a double-tap) can both observe "no profile yet" and both
-- create a venueless row for the same user. @@unique([userId, venueId]) does
-- not prevent this because Postgres treats NULL as distinct under a unique
-- constraint, and venueless profiles have venueId = NULL.
--
-- This is the same failure mode closed for venued+venueless duplicate pairs
-- by 20260819120000_cleanup_orphaned_venueless_profiles, but for the case of
-- two-or-more venueless rows existing with no venued profile at all yet.
--
-- First collapse any existing duplicates, keeping the oldest row per user —
-- the same one bootstrap-profile's `orderBy: { createdAt: 'asc' }` lookup
-- already resolves to. Every FK relation onto Profile in schema.prisma is
-- onDelete SetNull or Cascade, so this cannot violate a foreign key
-- constraint.
DELETE FROM "Profile" p
WHERE p."venueId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Profile" o
    WHERE o."userId" = p."userId"
      AND o."venueId" IS NULL
      AND (o."createdAt" < p."createdAt"
           OR (o."createdAt" = p."createdAt" AND o."id" < p."id"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "Profile_userId_venueless_key"
  ON "Profile"("userId")
  WHERE "venueId" IS NULL;
