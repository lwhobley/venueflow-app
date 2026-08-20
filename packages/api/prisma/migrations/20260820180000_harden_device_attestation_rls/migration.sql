-- 20260820170000_add_device_attestation created DeviceAttestation and
-- AttestationChallenge but did not enable Row Level Security, so the tables
-- landed unprotected on any database that already applied it. Migrations are
-- immutable, so this follows the same pair pattern as
-- 20260808134500_ai_usage_metering / 20260808150000_harden_ai_usage_event_rls.
--
-- Everything here is idempotent: it is correct both on a database that already
-- has the tables (production) and on a fresh one that just created them.

-- These server-owned tables are not a Supabase Data API surface. Attestation
-- public keys and single-use challenges must never be reachable from a browser
-- role.
ALTER TABLE "DeviceAttestation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttestationChallenge" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "DeviceAttestation" FROM anon;
    REVOKE ALL ON TABLE "AttestationChallenge" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "DeviceAttestation" FROM authenticated;
    REVOKE ALL ON TABLE "AttestationChallenge" FROM authenticated;
  END IF;
END
$$;

-- Domain constraints the original migration omitted. Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so guard on pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DeviceAttestation_signCount_check'
  ) THEN
    ALTER TABLE "DeviceAttestation"
      ADD CONSTRAINT "DeviceAttestation_signCount_check" CHECK ("signCount" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DeviceAttestation_environment_check'
  ) THEN
    ALTER TABLE "DeviceAttestation"
      ADD CONSTRAINT "DeviceAttestation_environment_check"
      CHECK ("environment" IN ('production', 'development'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AttestationChallenge_expiry_check'
  ) THEN
    ALTER TABLE "AttestationChallenge"
      ADD CONSTRAINT "AttestationChallenge_expiry_check" CHECK ("expiresAt" > "createdAt");
  END IF;
END
$$;
