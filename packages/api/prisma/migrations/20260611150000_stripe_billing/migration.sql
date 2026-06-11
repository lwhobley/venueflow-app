-- Stripe billing: invoice idempotency. Each Stripe invoice maps to one row, so
-- retried invoice webhooks upsert instead of inserting duplicates. Replaces the
-- prior non-unique lookup index.
DROP INDEX "Invoice_stripeInvoiceId_idx";
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");
