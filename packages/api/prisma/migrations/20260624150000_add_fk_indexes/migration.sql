-- Add covering indexes for foreign-key columns that lacked one. Without these,
-- ON DELETE SET NULL / CASCADE on the parent forces a sequential scan of the
-- child table, and lookups by these columns are unindexed.
CREATE INDEX "CrmNote_authorId_idx" ON "CrmNote"("authorId");
CREATE INDEX "ReservationSyncEvent_reservationId_idx" ON "ReservationSyncEvent"("reservationId");
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");
CREATE INDEX "ConversationRead_venueId_idx" ON "ConversationRead"("venueId");
CREATE INDEX "NotificationRead_venueId_idx" ON "NotificationRead"("venueId");
