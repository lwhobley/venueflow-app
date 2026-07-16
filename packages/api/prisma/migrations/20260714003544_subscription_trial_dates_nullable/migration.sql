-- Subscriptions created directly at an active/non-trial status (e.g. a
-- Stripe or Apple event applied before any trial existed) previously had to
-- stamp trialStartedAt/trialEndsAt to "now", which reads as a trial that
-- started and instantly expired. Allow these to be null instead.
ALTER TABLE "Subscription" ALTER COLUMN "trialStartedAt" DROP NOT NULL;
ALTER TABLE "Subscription" ALTER COLUMN "trialEndsAt" DROP NOT NULL;
