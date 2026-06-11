-- Idempotency keys for at-least-once webhook ingestion.

-- PosLaborPunch: one row per employee per business day per provider, so retried
-- labor deliveries upsert instead of double-counting hours/pay.
CREATE UNIQUE INDEX "PosLaborPunch_venueId_provider_externalEmployeeId_businessDa_key"
  ON "PosLaborPunch"("venueId", "provider", "externalEmployeeId", "businessDate");

-- ReservationSyncEvent: dedupe redelivered provider events. The prior non-unique
-- index is replaced by the unique one.
DROP INDEX "ReservationSyncEvent_venueId_provider_externalEventId_idx";
CREATE UNIQUE INDEX "ReservationSyncEvent_venueId_provider_externalEventId_key"
  ON "ReservationSyncEvent"("venueId", "provider", "externalEventId");
