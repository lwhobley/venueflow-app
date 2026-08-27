-- Prisma's single-column foreign keys prove that a referenced row exists, but
-- not that it belongs to the same venue. Enforce the tenant half of those
-- relationships in PostgreSQL so raw SQL and system/no-context code cannot
-- create cross-tenant schedule, chat, notification, or time-clock records.
BEGIN;

CREATE OR REPLACE FUNCTION public."assertTenantReferenceMatchesVenue"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reference_id text;
  reference_venue_id text;
BEGIN
  reference_id := to_jsonb(NEW) ->> TG_ARGV[0];
  IF reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT "venueId" FROM public.%I WHERE id = $1',
    TG_ARGV[1]
  ) INTO reference_venue_id USING reference_id;

  IF reference_venue_id IS NULL OR reference_venue_id <> NEW."venueId" THEN
    RAISE EXCEPTION '% % must reference a row in venue %', TG_TABLE_NAME, TG_ARGV[0], NEW."venueId"
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ScheduleShift_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "ScheduleShift"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');

CREATE TRIGGER "Availability_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "Availability"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');

CREATE TRIGGER "StaffRequest_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "StaffRequest"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');

CREATE TRIGGER "Message_conversation_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "conversationId" ON "Message"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('conversationId', 'Conversation');
CREATE TRIGGER "Message_sender_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "senderId" ON "Message"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('senderId', 'Profile');
CREATE TRIGGER "Message_shift_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "shiftId" ON "Message"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('shiftId', 'ScheduleShift');
CREATE TRIGGER "Message_swap_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "swapId" ON "Message"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('swapId', 'ShiftSwap');

CREATE TRIGGER "ConversationRead_conversation_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "conversationId" ON "ConversationRead"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('conversationId', 'Conversation');
CREATE TRIGGER "ConversationRead_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "ConversationRead"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');

CREATE TRIGGER "ChatImage_message_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "messageId" ON "ChatImage"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('messageId', 'Message');

CREATE TRIGGER "NotificationEvent_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "NotificationEvent"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');
CREATE TRIGGER "NotificationRead_notification_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "notificationId" ON "NotificationRead"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('notificationId', 'NotificationEvent');
CREATE TRIGGER "NotificationRead_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "NotificationRead"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');

CREATE TRIGGER "PushToken_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "PushToken"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');
CREATE TRIGGER "TimeEntry_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "profileId" ON "TimeEntry"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('profileId', 'Profile');

CREATE TRIGGER "ShiftSwap_requester_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "requesterProfileId" ON "ShiftSwap"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('requesterProfileId', 'Profile');
CREATE TRIGGER "ShiftSwap_target_profile_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "targetProfileId" ON "ShiftSwap"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('targetProfileId', 'Profile');
CREATE TRIGGER "ShiftSwap_requester_shift_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "requesterShiftId" ON "ShiftSwap"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('requesterShiftId', 'ScheduleShift');
CREATE TRIGGER "ShiftSwap_target_shift_tenant_fk"
BEFORE INSERT OR UPDATE OF "venueId", "targetShiftId" ON "ShiftSwap"
FOR EACH ROW EXECUTE FUNCTION public."assertTenantReferenceMatchesVenue"('targetShiftId', 'ScheduleShift');

COMMIT;
