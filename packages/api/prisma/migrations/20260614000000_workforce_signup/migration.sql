-- Workforce signup: employee invite flow + self-serve join with manager approval.
-- Adds: MembershipStatus enum, WorkplaceJoinRequestStatus enum,
--       membershipStatus on Profile, phone on Invite,
--       WorkplaceJoinRequest + WorkplaceJoinRequestEvent tables,
--       PG functions for the approval state machine.

-- ──────────────────────────────────────────────
-- Enums
-- ──────────────────────────────────────────────
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'active', 'rejected', 'revoked');
CREATE TYPE "WorkplaceJoinRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- ──────────────────────────────────────────────
-- Profile: membership status
-- null is treated as 'active' for backward compatibility.
-- ──────────────────────────────────────────────
ALTER TABLE "Profile" ADD COLUMN "membershipStatus" "MembershipStatus";

-- ──────────────────────────────────────────────
-- Invite: phone field for phone-based invite lookup
-- ──────────────────────────────────────────────
ALTER TABLE "Invite" ADD COLUMN "phone" TEXT;
CREATE INDEX "Invite_phone_idx" ON "Invite"("phone") WHERE "phone" IS NOT NULL;

-- ──────────────────────────────────────────────
-- WorkplaceJoinRequest
-- ──────────────────────────────────────────────
CREATE TABLE "WorkplaceJoinRequest" (
  "id"           TEXT NOT NULL,
  "venueId"      TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "status"       "WorkplaceJoinRequestStatus" NOT NULL DEFAULT 'pending',
  "decidedAt"    TIMESTAMP(3),
  "decidedById"  TEXT,
  "decisionNote" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkplaceJoinRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkplaceJoinRequest_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkplaceJoinRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WorkplaceJoinRequest_venueId_idx"        ON "WorkplaceJoinRequest"("venueId");
CREATE INDEX "WorkplaceJoinRequest_userId_idx"         ON "WorkplaceJoinRequest"("userId");
CREATE INDEX "WorkplaceJoinRequest_status_idx"         ON "WorkplaceJoinRequest"("status");
CREATE INDEX "WorkplaceJoinRequest_venueId_status_idx" ON "WorkplaceJoinRequest"("venueId", "status");

-- Prevent two pending requests for the same user+venue.
CREATE UNIQUE INDEX "WorkplaceJoinRequest_one_pending_per_user_venue_idx"
  ON "WorkplaceJoinRequest"("userId", "venueId")
  WHERE "status" = 'pending';

-- ──────────────────────────────────────────────
-- WorkplaceJoinRequestEvent (append-only audit log)
-- ──────────────────────────────────────────────
CREATE TABLE "WorkplaceJoinRequestEvent" (
  "id"        TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId"   TEXT,
  "eventType" TEXT NOT NULL,
  "payload"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkplaceJoinRequestEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkplaceJoinRequestEvent_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "WorkplaceJoinRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WorkplaceJoinRequestEvent_requestId_createdAt_idx"
  ON "WorkplaceJoinRequestEvent"("requestId", "createdAt");

-- ──────────────────────────────────────────────
-- Search indexes on Venue
-- ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Venue_name_lower_idx" ON "Venue"(lower("name"));
CREATE INDEX IF NOT EXISTS "Venue_code_idx" ON "Venue"("code") WHERE "code" IS NOT NULL;

-- ──────────────────────────────────────────────
-- PG function: request_join_workplace
-- Prevents duplicate active membership and duplicate pending request.
-- Caller passes the new request ID (cuid generated in application layer).
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION request_join_workplace(
  p_user_id  TEXT,
  p_venue_id TEXT
) RETURNS TEXT AS $$
DECLARE
  v_has_active_membership BOOLEAN;
  v_request_id            TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('workforce-user:' || p_user_id));
  -- A profile may belong to only one active venue at a time. Do not silently
  -- move an existing member to a second venue through the join workflow.
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

  -- Insert; the partial unique index will raise unique_violation if a pending
  -- request already exists for this user+venue pair.
  INSERT INTO "WorkplaceJoinRequest" (
    "id", "venueId", "userId", "status", "createdAt", "updatedAt"
  ) VALUES (
    v_request_id, p_venue_id, p_user_id, 'pending', NOW(), NOW()
  );

  -- Append audit event.
  INSERT INTO "WorkplaceJoinRequestEvent" (
    "id", "requestId", "actorId", "eventType", "createdAt"
  ) VALUES (
    gen_random_uuid()::text, v_request_id, p_user_id, 'requested', NOW()
  );

  RETURN v_request_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_pending_request' USING ERRCODE = 'P0002';
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────
-- PG function: approve_join_request
-- Verifies actor is manager/admin/owner for the venue, locks the request row,
-- confirms it is still pending, then activates the membership.
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id TEXT,
  p_actor_id   TEXT
) RETURNS void AS $$
DECLARE
  v_request    RECORD;
  v_is_manager BOOLEAN;
BEGIN
  -- Lock the request row for the duration of the transaction.
  SELECT * INTO v_request
  FROM "WorkplaceJoinRequest"
  WHERE "id" = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0003';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0004';
  END IF;

  -- Verify the actor holds an active manager/admin/owner role at this venue.
  SELECT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "userId" = p_actor_id
      AND "venueId" = v_request."venueId"
      AND "role" IN ('admin', 'owner', 'manager')
      AND ("membershipStatus" IS NULL OR "membershipStatus" = 'active')
  ) INTO v_is_manager;

  IF NOT v_is_manager THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0005';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('workforce-user:' || v_request."userId"));

  -- Mark request approved.
  UPDATE "WorkplaceJoinRequest"
  SET "status"      = 'approved',
      "decidedAt"   = NOW(),
      "decidedById" = p_actor_id,
      "updatedAt"   = NOW()
  WHERE "id" = p_request_id;

  -- Activate the user's profile membership (profile was created at signup).
  UPDATE "Profile"
  SET "venueId"          = v_request."venueId",
      "role"             = 'staff',
      "membershipStatus" = 'active',
      "updatedAt"        = NOW()
  WHERE "userId" = v_request."userId";

  -- Append audit event.
  INSERT INTO "WorkplaceJoinRequestEvent" (
    "id", "requestId", "actorId", "eventType", "payload", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    p_request_id,
    p_actor_id,
    'approved',
    jsonb_build_object('decidedById', p_actor_id),
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────
-- PG function: reject_join_request
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_join_request(
  p_request_id TEXT,
  p_actor_id   TEXT,
  p_note       TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_request    RECORD;
  v_is_manager BOOLEAN;
BEGIN
  SELECT * INTO v_request
  FROM "WorkplaceJoinRequest"
  WHERE "id" = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0003';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0004';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM "Profile"
    WHERE "userId" = p_actor_id
      AND "venueId" = v_request."venueId"
      AND "role" IN ('admin', 'owner', 'manager')
      AND ("membershipStatus" IS NULL OR "membershipStatus" = 'active')
  ) INTO v_is_manager;

  IF NOT v_is_manager THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0005';
  END IF;

  UPDATE "WorkplaceJoinRequest"
  SET "status"       = 'rejected',
      "decidedAt"    = NOW(),
      "decidedById"  = p_actor_id,
      "decisionNote" = p_note,
      "updatedAt"    = NOW()
  WHERE "id" = p_request_id;

  INSERT INTO "WorkplaceJoinRequestEvent" (
    "id", "requestId", "actorId", "eventType", "payload", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    p_request_id,
    p_actor_id,
    'rejected',
    jsonb_build_object('decidedById', p_actor_id, 'note', p_note),
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────
-- PG function: cancel_join_request
-- Only the requesting user may cancel their own pending request.
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_join_request(
  p_request_id TEXT,
  p_user_id    TEXT
) RETURNS void AS $$
DECLARE
  v_request RECORD;
BEGIN
  SELECT * INTO v_request
  FROM "WorkplaceJoinRequest"
  WHERE "id" = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0003';
  END IF;

  IF v_request."userId" <> p_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0005';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0004';
  END IF;

  UPDATE "WorkplaceJoinRequest"
  SET "status"    = 'cancelled',
      "decidedAt" = NOW(),
      "updatedAt" = NOW()
  WHERE "id" = p_request_id;

  INSERT INTO "WorkplaceJoinRequestEvent" (
    "id", "requestId", "actorId", "eventType", "createdAt"
  ) VALUES (
    gen_random_uuid()::text, p_request_id, p_user_id, 'cancelled', NOW()
  );
END;
$$ LANGUAGE plpgsql;
