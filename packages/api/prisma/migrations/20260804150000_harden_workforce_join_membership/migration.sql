-- Prevent cross-venue membership takeover and privilege carry-over for
-- projects that already applied the original workforce signup migration.
CREATE OR REPLACE FUNCTION request_join_workplace(
  p_user_id TEXT,
  p_venue_id TEXT
) RETURNS TEXT AS $$
DECLARE
  v_has_active_membership BOOLEAN;
  v_request_id TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('workforce-user:' || p_user_id));
  SELECT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "userId" = p_user_id
      AND "venueId" IS NOT NULL
      AND ("membershipStatus" IS NULL OR "membershipStatus" = 'active')
  ) INTO v_has_active_membership;

  IF v_has_active_membership THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
  END IF;

  v_request_id := gen_random_uuid()::text;
  INSERT INTO "WorkplaceJoinRequest" ("id", "venueId", "userId", "status", "createdAt", "updatedAt")
  VALUES (v_request_id, p_venue_id, p_user_id, 'pending', NOW(), NOW());
  INSERT INTO "WorkplaceJoinRequestEvent" ("id", "requestId", "actorId", "eventType", "createdAt")
  VALUES (gen_random_uuid()::text, v_request_id, p_user_id, 'requested', NOW());
  RETURN v_request_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_pending_request' USING ERRCODE = 'P0002';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id TEXT,
  p_actor_id TEXT
) RETURNS void AS $$
DECLARE
  v_request RECORD;
  v_is_manager BOOLEAN;
  v_has_active_membership BOOLEAN;
BEGIN
  SELECT * INTO v_request FROM "WorkplaceJoinRequest" WHERE "id" = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0003'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0004'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "userId" = p_actor_id
      AND "venueId" = v_request."venueId"
      AND "role" IN ('admin', 'owner', 'manager')
      AND ("membershipStatus" IS NULL OR "membershipStatus" = 'active')
  ) INTO v_is_manager;
  IF NOT v_is_manager THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0005'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('workforce-user:' || v_request."userId"));

  SELECT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "userId" = v_request."userId"
      AND "venueId" IS NOT NULL
      AND ("membershipStatus" IS NULL OR "membershipStatus" = 'active')
  ) INTO v_has_active_membership;
  IF v_has_active_membership THEN RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001'; END IF;

  UPDATE "WorkplaceJoinRequest"
  SET "status" = 'approved', "decidedAt" = NOW(), "decidedById" = p_actor_id, "updatedAt" = NOW()
  WHERE "id" = p_request_id;
  UPDATE "Profile"
  SET "venueId" = v_request."venueId", "role" = 'staff', "membershipStatus" = 'active', "updatedAt" = NOW()
  WHERE "userId" = v_request."userId";
  INSERT INTO "WorkplaceJoinRequestEvent" ("id", "requestId", "actorId", "eventType", "payload", "createdAt")
  VALUES (gen_random_uuid()::text, p_request_id, p_actor_id, 'approved', jsonb_build_object('decidedById', p_actor_id), NOW());
END;
$$ LANGUAGE plpgsql;
