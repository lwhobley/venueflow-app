-- Apple App Attest device attestation. The geofenced time clock validates
-- client-supplied coordinates, so attestation is what establishes that a punch
-- came from a genuine build of the app on real Apple hardware.
CREATE TABLE "DeviceAttestation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceAttestation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeviceAttestation_signCount_check" CHECK ("signCount" >= 0),
    CONSTRAINT "DeviceAttestation_environment_check"
      CHECK ("environment" IN ('production', 'development'))
);

-- Single-use, short-lived nonce binding an attestation or assertion to one
-- server-issued request.
CREATE TABLE "AttestationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttestationChallenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttestationChallenge_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAttestation_keyId_key" ON "DeviceAttestation"("keyId");

-- CreateIndex
CREATE INDEX "DeviceAttestation_userId_idx" ON "DeviceAttestation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AttestationChallenge_value_key" ON "AttestationChallenge"("value");

-- CreateIndex
CREATE INDEX "AttestationChallenge_userId_idx" ON "AttestationChallenge"("userId");

-- CreateIndex
CREATE INDEX "AttestationChallenge_expiresAt_idx" ON "AttestationChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceAttestation" ADD CONSTRAINT "DeviceAttestation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttestationChallenge" ADD CONSTRAINT "AttestationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These server-owned tables are not a Supabase Data API surface. Attestation
-- public keys and challenges must never be reachable from a browser role.
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
