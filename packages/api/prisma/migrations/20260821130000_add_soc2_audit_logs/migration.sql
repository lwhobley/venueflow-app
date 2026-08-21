-- 20260821130000_add_soc2_audit_logs
-- Extends AuditLog table for SOC 2 system-wide immutable audit logging:
-- - Allows venueId to be NULL for system-level and auth events
-- - Adds ipAddress and userAgent columns
-- - Adds indexes on (action, createdAt) and (actorProfileId, createdAt)
-- - Enforces fail-closed RLS to keep audit logs strictly server-mediated

ALTER TABLE "AuditLog" ALTER COLUMN "venueId" DROP NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorProfileId_createdAt_idx" ON "AuditLog"("actorProfileId", "createdAt");

-- Ensure RLS is active on AuditLog table
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "AuditLog" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "AuditLog" FROM authenticated;
  END IF;
END
$$;
