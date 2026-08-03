# Production operations

## Health and monitoring

- API: `https://venue-wrangler-api-922889404273.us-east1.run.app/api/health`
- Cloud Run service: `venue-wrangler-api` in `us-east1`
- The `venue_wrangler_5xx` log-based metric counts HTTP 5xx responses.
- Alert policy: `Venue Wrangler API 5xx errors` (`projects/venuewrangler/alertPolicies/7994759751285739344`).
- The policy is enabled and sends email notifications through the production alerts notification channel.

Keep a second notification destination (for example, an on-call webhook) for a staffed production launch.

## Rollback

Cloud Run keeps immutable revisions. To roll back, list revisions and route traffic to the last known-good one:

```bash
gcloud run revisions list --service=venue-wrangler-api --region=us-east1 --project=venuewrangler
gcloud run services update-traffic venue-wrangler-api \
  --to-revisions=venue-wrangler-api-REVISION=100 \
  --region=us-east1 --project=venuewrangler
```

After rollback, verify `/api/health`, `/api/v1/documents` (expect `401` without a session), and the mobile client login flow.

## Database backups and restore

The production database is Supabase project `dhgyezfkgbzzsuyrdpek`. Supabase provides managed daily backups; point-in-time recovery (PITR) must be enabled in the project dashboard for the selected paid plan before launch. Verify it under **Database → Backups** and perform a restore drill against a separate project before the first customer migration.

Never store a database password in this repository. For a restore, pause Cloud Run traffic, restore or clone the Supabase project, update `DATABASE_URL` as a new Cloud Run revision, run Prisma migrations, smoke-test, and then shift traffic back.

## Release checklist

1. Confirm GitHub Mobile CI and API CI are green.
2. Confirm the Cloud Run revision has the production secret set and 100% traffic.
3. Confirm Stripe live checkout creates a subscription for an authenticated venue.
4. Confirm the alert notification channel is verified.
5. Record the current revision ID before every deploy for rollback.
