-- Cleans up a duplicate-profile state left over from before app.controller.ts
-- was fixed to delete the venueless signup profile when a user creates a
-- venue. Any user who signed up (which always creates a venueless Profile
-- row) and later created a venue (which creates a *second*, venued Profile
-- row) was left with both rows. Because several profile-resolution fallbacks
-- pick "the oldest matching profile" when no venue is explicitly requested,
-- the older venueless row could outrank the real venue membership and
-- silently disable venue-scoped behavior (including tenant isolation) for
-- that request.
--
-- Every FK relation onto Profile in schema.prisma is declared
-- onDelete: SetNull or onDelete: Cascade, so this delete cannot violate a
-- foreign key constraint. A venueless profile realistically only ever has a
-- PushToken row (registered right after login, before venue creation); that
-- row cascades away, which just means the device re-registers for push on
-- its next token refresh.
--
-- Scope: only removes a profile that is (a) venueless and (b) not the user's
-- only profile, i.e. the same user already has at least one venued profile.
-- A user who is still genuinely venueless (mid-onboarding, no venue created
-- yet) is left untouched.
DELETE FROM "Profile" p
WHERE p."venueId" IS NULL
  AND p."userId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "Profile" p2
    WHERE p2."userId" = p."userId"
      AND p2."venueId" IS NOT NULL
  );
