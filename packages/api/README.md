# Venue Wrangler NestJS API

This package is the production backend for Venue Wrangler.

## Local Setup

```bash
npm install
npm run api:prisma:generate
npm run api:migrate:dev
npm run api:dev
```

## Production migrations

Use `.github/workflows/deploy-api.yml` for production releases. It requires an
immutable image digest, executes the preconfigured `venue-wrangler-api-migrate`
Cloud Run job, waits for `prisma migrate deploy` to succeed, and only then
updates the serving service. The migration job must carry `DATABASE_URL` and
`DATABASE_DIRECT_URL` through Secret Manager and must not serve traffic.

Every API container also runs `assert-migrations-current.mjs` before NestJS, so
a skipped or failed release job leaves the new revision unhealthy instead of
serving against a stale schema.

Do **not** rely on `prisma db push` in production; it does not record migration history.

The app also has a separate `supabase/migrations` history and is not the deployment path here.

## Notable constraints & indexes (enforced in CI)

- `TimeEntry_open_state_check` — open entries must have `clockOutAt` null and vice versa.
- Partial unique index `TimeEntry_profileId_open_key` (one open entry per profile).
- Partial unique index `Profile_unclaimed_venue_email_key` (one unclaimed roster row per venue + email) from migration `20260810153000_profile_accrual_defaults_and_unclaimed_unique`.
- New profiles default `sickHoursAccrued` / `ptoHoursAccrued` to `0` (same migration).
- Optional `MEDIA_TOKEN_SECRET` signs media access tokens; falls back to `JWT_SECRET`.
