-- Prevent duplicate open ManagerGoal rows for the same venue/title/date.
--
-- wrangler.controller.ts's CREATE_FOLLOW_UP action does an unguarded
-- findFirst-then-create with no transaction or lock:
--
--   findFirst({ where: { venueId, title, targetDate, status: 'open' } })
--   ...if none...
--   managerGoal.create(...)
--
-- Two concurrent calls (double-tap, client retry) both observe "no existing
-- follow-up" and both insert. ManagerGoal carried only non-unique indexes on
-- (venueId, targetDate) and (venueId, status), so nothing at the DB layer
-- prevented the duplicate.
--
-- This is the same defect class closed for venueless Profile rows by
-- 20260821140000_prevent_duplicate_venueless_profiles, and it follows the
-- partial-unique-index idiom already used by
-- WorkplaceJoinRequest_one_pending_per_user_venue_idx (20260614000000) and
-- TimeEntry_profileId_open_key (20260608130000).
--
-- The predicate is scoped to status = 'open' so it exactly mirrors the
-- findFirst above: completed or cancelled goals are left unconstrained, and a
-- new follow-up may legitimately be raised again after an earlier one is
-- closed out.

-- Collapse any existing duplicates first, keeping the oldest row per group —
-- the same one findFirst would have resolved to. ManagerGoal is referenced by
-- no other model as a foreign key, so this cannot violate a constraint.
DELETE FROM "ManagerGoal" g
WHERE g."status" = 'open'
  AND EXISTS (
    SELECT 1 FROM "ManagerGoal" o
    WHERE o."venueId" = g."venueId"
      AND o."title" = g."title"
      AND o."targetDate" = g."targetDate"
      AND o."status" = 'open'
      AND (o."createdAt" < g."createdAt"
           OR (o."createdAt" = g."createdAt" AND o."id" < g."id"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ManagerGoal_venue_title_date_open_key"
  ON "ManagerGoal"("venueId", "title", "targetDate")
  WHERE "status" = 'open';
