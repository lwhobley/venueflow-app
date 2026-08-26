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

The production database is Supabase project `dhgyezfkgbzzsuyrdpek`. Confirm the current plan and PITR in the Supabase dashboard before treating managed backups as the primary recovery path. `.github/workflows/database-backup.yml` is the required nightly logical backup; deploys also require `backups_and_restore_verified=true`.

Until an upgrade is possible, `.github/workflows/database-backup.yml` provides a nightly logical backup to S3 with SSE-S3 encryption and restores every dump into an isolated PostgreSQL service container that is destroyed with the GitHub runner. Configure these repository secrets before relying on it: `PRODUCTION_POOLER_DATABASE_URL` (Supavisor session-mode URL), `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_AWS_REGION`, and `BACKUP_S3_BUCKET`. The backup IAM identity must allow `s3:GetLifecycleConfiguration` on that bucket in addition to object upload/read verification; the workflow fails if its enabled `database-backups/` lifecycle rule is not exactly 30 days or if the restore/integrity check fails.

Never store a database password in this repository. For a restore, pause Cloud Run traffic, restore or clone the Supabase project, update `DATABASE_URL` as a new Cloud Run revision, run Prisma migrations, smoke-test, and then shift traffic back.

Production credentials on the Cloud Run service and both release jobs must use
Secret Manager references (`--update-secrets` / `--set-secrets`), never literal
`--set-env-vars` values. The deployment workflow rejects literal database, JWT,
AWS, billing, email, and Gemini credentials before it changes production.

## Retention cleanup

`.github/workflows/retention-cleanup.yml` executes the preconfigured `venue-wrangler-api-retention` Cloud Run Job daily. Provision it with the same database secrets and network access as the migration job. GitHub must use a dedicated `GCP_RETENTION_SERVICE_ACCOUNT` identity that can execute only this job; do not reuse the production deployment identity. Deployment preflights the job before migrations, updates it to the same immutable API image, verifies a no-traffic candidate revision, and only then promotes that revision to production. Treat a missed or failed run as an operational alert: audit logs, expired attestation challenges, and statutory wage records are purged only by this external job.

### Connection budget

Set `DATABASE_POOL_SIZE=5` for each Cloud Run revision unless the Supabase connection budget and Cloud Run maximum instance count have been reviewed together. The current database permits 60 backend connections. Cloud Run service-level autoscaling is capped at 8 instances (40 pooled connections), leaving 20 connections for Supabase administration, migrations, and incident response. Recheck this budget before changing either limit.

## POS webhook secret rotation

Managers can rotate a compromised or stale POS secret with `POST /api/v1/pos/connections/:id/rotate-secret`. The connection lookup is venue-scoped. The response displays the new plaintext secret once; only its SHA-256 digest is stored. Update the POS integration immediately because the old secret stops authenticating as soon as rotation completes. Never paste the plaintext secret into source control, tickets, or logs.

## Release checklist

1. Confirm GitHub Mobile CI and API CI are green.
2. Deploy through `.github/workflows/deploy-api.yml`; its production gate requires verified backups/restore, secondary alerting, billing configuration, an approved attestation mode and Team ID, and a successful migration job before traffic changes.
3. Confirm Stripe live checkout creates a subscription for an authenticated venue.
4. Confirm the alert notification channel is verified.
5. Record the current revision ID before every deploy for rollback.
6. Confirm the retention Cloud Run Job was updated and its most recent scheduled execution succeeded.
