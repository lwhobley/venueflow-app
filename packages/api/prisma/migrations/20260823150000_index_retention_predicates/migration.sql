-- Support bounded global retention sweeps without scanning venue/action indexes.
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AttestationChallenge_consumedAt_idx" ON "AttestationChallenge"("consumedAt");
