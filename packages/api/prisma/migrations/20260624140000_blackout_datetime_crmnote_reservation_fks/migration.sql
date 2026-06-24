-- NOTE: This migration is written to be idempotent. The schema changes below
-- were originally applied to the live database via `prisma db push` without a
-- committed migration, so the migration history drifted from the database.
-- Writing it idempotently lets `migrate deploy` (a) reproduce the schema on a
-- fresh database and (b) run as a safe no-op on the already-modified database.

-- BlackoutDate: startDate/endDate TEXT -> TIMESTAMP(3).
-- Existing rows store ISO date strings (e.g. '2026-06-23'); cast them explicitly.
-- Re-running against an already-converted column is a no-op (timestamp::timestamp).
ALTER TABLE "BlackoutDate"
  ALTER COLUMN "startDate" TYPE TIMESTAMP(3) USING "startDate"::timestamp,
  ALTER COLUMN "endDate"   TYPE TIMESTAMP(3) USING "endDate"::timestamp;

-- CrmNote.authorId: make nullable and switch FK to ON DELETE SET NULL so that
-- deleting a Profile snapshots notes as authored by "Former Staff" instead of
-- cascade-deleting the notes.
ALTER TABLE "CrmNote" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "CrmNote" DROP CONSTRAINT IF EXISTS "CrmNote_authorId_fkey";
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reservation.guestId -> Guest FK (SET NULL). Null out any orphaned references
-- before adding the constraint so it can be validated.
UPDATE "Reservation" SET "guestId" = NULL
  WHERE "guestId" IS NOT NULL
    AND "guestId" NOT IN (SELECT "id" FROM "Guest");
ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_guestId_fkey";
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ReservationSyncEvent.reservationId -> Reservation FK (SET NULL).
UPDATE "ReservationSyncEvent" SET "reservationId" = NULL
  WHERE "reservationId" IS NOT NULL
    AND "reservationId" NOT IN (SELECT "id" FROM "Reservation");
ALTER TABLE "ReservationSyncEvent" DROP CONSTRAINT IF EXISTS "ReservationSyncEvent_reservationId_fkey";
ALTER TABLE "ReservationSyncEvent" ADD CONSTRAINT "ReservationSyncEvent_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- VenueEvent.reservationId -> Reservation FK (SET NULL).
UPDATE "VenueEvent" SET "reservationId" = NULL
  WHERE "reservationId" IS NOT NULL
    AND "reservationId" NOT IN (SELECT "id" FROM "Reservation");
ALTER TABLE "VenueEvent" DROP CONSTRAINT IF EXISTS "VenueEvent_reservationId_fkey";
ALTER TABLE "VenueEvent" ADD CONSTRAINT "VenueEvent_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
