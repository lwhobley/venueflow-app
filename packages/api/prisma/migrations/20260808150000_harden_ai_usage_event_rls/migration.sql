-- AI usage metering is server-owned tenant data. Keep it behind the same
-- defense-in-depth boundary as the rest of the API-first schema.
ALTER TABLE public."AiUsageEvent" ENABLE ROW LEVEL SECURITY;

-- Supabase provides anon/authenticated roles; plain Postgres CI does not.
-- Revoke browser-facing access only when those roles exist so this migration
-- remains portable across both environments.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."AiUsageEvent" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."AiUsageEvent" FROM authenticated';
  END IF;
END
$$;
