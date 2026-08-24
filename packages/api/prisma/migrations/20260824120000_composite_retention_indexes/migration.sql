-- The retention job filters by cutoff timestamp but paged results ordered by
-- id, so neither the standalone timestamp index nor a plain id order could
-- satisfy both parts of the query in one scan. Replace each standalone
-- timestamp index with a composite (timestamp, id) index that serves the
-- filter and the deterministic page order together.
DROP INDEX "AuditLog_createdAt_idx";
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");

DROP INDEX "RetainedTimeEntry_originCreatedAt_idx";
CREATE INDEX "RetainedTimeEntry_originCreatedAt_id_idx" ON "RetainedTimeEntry"("originCreatedAt", "id");
