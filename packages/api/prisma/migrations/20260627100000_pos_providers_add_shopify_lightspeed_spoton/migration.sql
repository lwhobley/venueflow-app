-- Extend the PosProvider enum with three additional webhook-push vendors so
-- venues can register native ingest connections for Shopify POS, Lightspeed
-- Restaurant, and SpotOn. Each ADD VALUE is idempotent (IF NOT EXISTS) so
-- re-running the migration is safe.
ALTER TYPE "PosProvider" ADD VALUE IF NOT EXISTS 'shopify_pos';
ALTER TYPE "PosProvider" ADD VALUE IF NOT EXISTS 'lightspeed_restaurant';
ALTER TYPE "PosProvider" ADD VALUE IF NOT EXISTS 'spoton';
