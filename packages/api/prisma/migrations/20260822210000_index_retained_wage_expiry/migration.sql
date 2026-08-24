-- The retention job filters by the source record's creation time. Index that
-- predicate so the daily sweep does not scan the entire retained wage table.
CREATE INDEX "RetainedTimeEntry_originCreatedAt_idx"
ON "RetainedTimeEntry"("originCreatedAt");
