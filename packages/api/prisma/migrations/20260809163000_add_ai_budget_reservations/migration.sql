-- Reserve AI budget before provider calls so concurrent requests across API
-- instances cannot all pass the same monthly-spend check.
CREATE TABLE "AiBudgetReservation" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "reservedCostMicros" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiBudgetReservation_cost_check" CHECK ("reservedCostMicros" > 0),
  CONSTRAINT "AiBudgetReservation_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "AiBudgetReservation_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AiBudgetReservation_venueId_expiresAt_idx"
  ON "AiBudgetReservation"("venueId", "expiresAt");

-- This server-owned table is not a Supabase Data API surface.
ALTER TABLE "AiBudgetReservation" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "AiBudgetReservation" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "AiBudgetReservation" FROM authenticated;
  END IF;
END
$$;
