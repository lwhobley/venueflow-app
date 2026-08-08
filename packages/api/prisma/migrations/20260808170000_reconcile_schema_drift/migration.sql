-- Reconcile Prisma schema changes that previously reached application code
-- without an accompanying migration.

ALTER TYPE "BarStockCategory" ADD VALUE IF NOT EXISTS 'protein';
ALTER TYPE "BarStockCategory" ADD VALUE IF NOT EXISTS 'produce';
ALTER TYPE "BarStockCategory" ADD VALUE IF NOT EXISTS 'dairy';
ALTER TYPE "BarStockCategory" ADD VALUE IF NOT EXISTS 'dry_goods';
ALTER TYPE "BarStockCategory" ADD VALUE IF NOT EXISTS 'bakery';
ALTER TYPE "BarStockCategory" ADD VALUE IF NOT EXISTS 'frozen';

-- A user can have a separate membership/profile at multiple venues. The old
-- global unique index made the multi-venue model impossible to persist.
DROP INDEX IF EXISTS "Profile_userId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Profile_userId_venueId_key"
  ON "Profile"("userId", "venueId");
CREATE INDEX IF NOT EXISTS "Profile_userId_idx" ON "Profile"("userId");
