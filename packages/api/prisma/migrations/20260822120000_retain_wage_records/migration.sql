-- Preserve wage records past tenant offboarding.
--
-- TimeEntry.venue is declared onDelete: Cascade, so deleting a Venue removed
-- every employee's clock-in history for that venue. The account-deletion flow
-- in app.controller.ts does exactly that when a sole owner confirms
-- deleteOwnedVenues, which meant one person's account deletion destroyed the
-- payroll history of every other member of staff — people who are not the data
-- subject and did not consent.
--
-- That contradicted TimeEntry's own schema comment ("Nullable + SetNull so wage
-- records survive account deletion (FLSA retention)") and the FLSA §516.5
-- three-year retention requirement. The careful profileFullName snapshot the
-- controller performs was wasted work, because the rows were about to be
-- cascaded away regardless.
--
-- RetainedTimeEntry intentionally has no Venue foreign key and no `venueId`
-- column: the venue no longer exists when these rows matter, a real FK would
-- cascade them away again, and a `venueId` field would pull the model into
-- VENUE_SCOPED_MODELS (see prisma/tenant-scope.ts), where the tenant-isolation
-- extension would filter it to a venue that has been deleted — making it
-- permanently unreadable. `originVenueId` is a historical reference only. This
-- mirrors the documented reasoning for ObjectDeletionJob.

CREATE TABLE "RetainedTimeEntry" (
  "id" TEXT NOT NULL,
  "originVenueId" TEXT NOT NULL,
  "originVenueName" TEXT,
  "profileFullName" TEXT,
  "profileEmail" TEXT,
  "clockInAt" TIMESTAMP(3) NOT NULL,
  "clockOutAt" TIMESTAMP(3),
  "isOpen" BOOLEAN NOT NULL,
  "breaks" JSONB,
  "originCreatedAt" TIMESTAMP(3) NOT NULL,
  "retainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetainedTimeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RetainedTimeEntry_originVenueId_idx" ON "RetainedTimeEntry"("originVenueId");
CREATE INDEX "RetainedTimeEntry_retainedAt_idx" ON "RetainedTimeEntry"("retainedAt");

-- The application is server-mediated; retained payroll data must never be
-- reachable via Supabase's Data/GraphQL API roles.
ALTER TABLE "RetainedTimeEntry" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "RetainedTimeEntry" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "RetainedTimeEntry" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
