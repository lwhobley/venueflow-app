-- CreateTable
CREATE TABLE "DeviceAttestation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttestationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttestationChallenge_pkey" PRIMARY KEY ("id")
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
