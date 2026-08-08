-- AI usage metering is server-owned tenant data. Keep it behind the same
-- defense-in-depth boundary as the rest of the API-first schema.
ALTER TABLE public."AiUsageEvent" ENABLE ROW LEVEL SECURITY;

-- No direct Data API policies are intentionally created. Application access
-- goes through the trusted API/database role, which is responsible for venue
-- scoping. Explicitly keep browser-facing roles without table privileges.
REVOKE ALL ON TABLE public."AiUsageEvent" FROM anon, authenticated;
