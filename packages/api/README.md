# Venue Wrangler NestJS API

This package is the production backend for Venue Wrangler.

## Local Setup

```bash
npm install
npm run api:prisma:generate
npm run api:migrate:dev
npm run api:dev
```

The API defaults to `http://localhost:4000`.

## Railway Database

This API expects Railway Postgres in `DATABASE_URL`. Railway deploys run
`npm run release -w @venue-wrangler/api`, which applies Prisma migrations before
starting the service.

To apply migrations manually against the linked Railway environment:

```bash
railway login
railway run npm run prisma:migrate:deploy -w @venue-wrangler/api
```

## Migration notes

- `TimeEntry` has a **partial unique index** (`TimeEntry_profileId_open_key`,
  one open entry per profile) that Prisma's schema language cannot express —
  it lives only in migration `20260608130000_clock_in_open_unique`. If
  `prisma migrate dev` ever generates a `DROP INDEX` for it, delete that
  statement before applying the migration.
- `Invite.phone` has a partial lookup index (`Invite_phone_idx`, excluding null
  values) that Prisma's schema language cannot express. It lives in migration
  `20260614000000_workforce_signup` and is intentionally omitted from
  `schema.prisma`.
