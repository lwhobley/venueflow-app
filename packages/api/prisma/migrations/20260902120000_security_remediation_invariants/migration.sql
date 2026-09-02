-- VW-A16: Re-pin search_path on functions that lost proconfig via CREATE OR REPLACE.
-- Pinning inside the function definition survives future CREATE OR REPLACE.
ALTER FUNCTION public.approve_join_request(TEXT, TEXT)
  SET search_path = public, pg_temp;

ALTER FUNCTION public."assertTenantReferenceMatchesVenue"()
  SET search_path = public, pg_temp;

-- VW-A01: Database length CHECK constraints on high-volume user-authored columns
-- as a persistent backstop against DTO regression or direct data writes.

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_text_len_check"
    CHECK (char_length("text") <= 4000) NOT VALID;
ALTER TABLE "Message" VALIDATE CONSTRAINT "Message_text_len_check";

ALTER TABLE "LogbookEntry"
  ADD CONSTRAINT "LogbookEntry_body_len_check"
    CHECK (char_length("body") <= 10000) NOT VALID;
ALTER TABLE "LogbookEntry" VALIDATE CONSTRAINT "LogbookEntry_body_len_check";

ALTER TABLE "EmailTemplate"
  ADD CONSTRAINT "EmailTemplate_body_len_check"
    CHECK (char_length("body") <= 20000) NOT VALID;
ALTER TABLE "EmailTemplate" VALIDATE CONSTRAINT "EmailTemplate_body_len_check";

ALTER TABLE "EmailTemplate"
  ADD CONSTRAINT "EmailTemplate_subject_len_check"
    CHECK (char_length("subject") <= 500) NOT VALID;
ALTER TABLE "EmailTemplate" VALIDATE CONSTRAINT "EmailTemplate_subject_len_check";

ALTER TABLE "StaffRequest"
  ADD CONSTRAINT "StaffRequest_title_len_check"
    CHECK (char_length("title") <= 200) NOT VALID;
ALTER TABLE "StaffRequest" VALIDATE CONSTRAINT "StaffRequest_title_len_check";

ALTER TABLE "StaffRequest"
  ADD CONSTRAINT "StaffRequest_details_len_check"
    CHECK (char_length("details") <= 4000) NOT VALID;
ALTER TABLE "StaffRequest" VALIDATE CONSTRAINT "StaffRequest_details_len_check";
