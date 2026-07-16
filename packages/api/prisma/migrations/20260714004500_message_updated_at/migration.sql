-- Optimistic-concurrency guard for the reaction-toggle read-modify-write on
-- Message.reactions (a JSON column), so two simultaneous reactions can't
-- silently clobber each other.
ALTER TABLE "Message" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
