-- Reservation reminders + confirmations
ALTER TABLE "Reservation"
  ADD COLUMN "reminderSentAt"     TIMESTAMP(3),
  ADD COLUMN "confirmationSentAt" TIMESTAMP(3);

CREATE INDEX "Reservation_reminderSentAt_reservationTime_idx"
  ON "Reservation"("reminderSentAt", "reservationTime");

-- Waitlist auto-notify
ALTER TABLE "Waitlist"
  ADD COLUMN "guestEmail" TEXT,
  ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Reservation holds (manager-imposed time-slot blocks)
CREATE TABLE "ReservationHold" (
  "id"        TEXT NOT NULL,
  "venueId"   TEXT NOT NULL,
  "startsAt"  TIMESTAMP(3) NOT NULL,
  "endsAt"    TIMESTAMP(3) NOT NULL,
  "reason"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReservationHold_venueId_startsAt_idx" ON "ReservationHold"("venueId", "startsAt");

ALTER TABLE "ReservationHold"
  ADD CONSTRAINT "ReservationHold_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
