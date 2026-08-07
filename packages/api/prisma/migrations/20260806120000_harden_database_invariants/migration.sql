-- Fail without modifying data if an existing environment violates an invariant.
-- The application already treats each of these keys as unique; production was
-- checked before this migration was authored and had zero conflicts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Subscription" GROUP BY "venueId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce one subscription per venue: duplicate Subscription.venueId values exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "Subscription" WHERE "externalSubscriptionId" IS NOT NULL GROUP BY "externalSubscriptionId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce external subscription uniqueness: duplicates exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "TableState" GROUP BY "tableId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce one live state per table: duplicate TableState.tableId values exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "PosConnection" GROUP BY "venueId", "provider" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce POS connection uniqueness: duplicate venue/provider rows exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "ReservationConnection" GROUP BY "venueId", "provider" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce reservation connection uniqueness: duplicate venue/provider rows exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "Reservation" WHERE "externalId" IS NOT NULL GROUP BY "venueId", "source", "externalId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce external reservation uniqueness: duplicate venue/source/externalId rows exist';
  END IF;
  IF EXISTS (SELECT 1 FROM "PaymentMethod" GROUP BY "venueId", "stripePaymentMethodId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Cannot enforce payment method uniqueness: duplicate venue/payment-method rows exist';
  END IF;
END $$;

DROP INDEX IF EXISTS "Subscription_venueId_idx";
DROP INDEX IF EXISTS "Subscription_externalSubscriptionId_idx";
DROP INDEX IF EXISTS "TableState_tableId_idx";
DROP INDEX IF EXISTS "PosConnection_venueId_provider_idx";
DROP INDEX IF EXISTS "ReservationConnection_venueId_provider_idx";

CREATE UNIQUE INDEX "Subscription_venueId_key" ON "Subscription"("venueId");
CREATE UNIQUE INDEX "Subscription_externalSubscriptionId_key" ON "Subscription"("externalSubscriptionId");
CREATE UNIQUE INDEX "TableState_tableId_key" ON "TableState"("tableId");
CREATE UNIQUE INDEX "PosConnection_venueId_provider_key" ON "PosConnection"("venueId", "provider");
CREATE UNIQUE INDEX "ReservationConnection_venueId_provider_key" ON "ReservationConnection"("venueId", "provider");
CREATE UNIQUE INDEX "Reservation_venueId_source_externalId_key" ON "Reservation"("venueId", "source", "externalId");
CREATE UNIQUE INDEX "PaymentMethod_venueId_stripePaymentMethodId_key" ON "PaymentMethod"("venueId", "stripePaymentMethodId");
CREATE INDEX "Waitlist_guestId_idx" ON "Waitlist"("guestId");

ALTER TABLE "SubscriptionEvent"
  ADD CONSTRAINT "SubscriptionEvent_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Waitlist"
  ADD CONSTRAINT "Waitlist_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "Guest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
