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

## Production database and deployment

Production uses Supabase PostgreSQL and deploys the API to Google Cloud Run.
Set `DATABASE_URL` to the Supavisor/session-pooler connection string and run
`npm run release -w @venue-wrangler/api` before starting a new revision so
Prisma migrations are applied first.

To inspect the linked Supabase project or run database advisors:

```bash
supabase projects list
supabase db advisors --linked
```

Do not put a production database password in this repository. Configure the
Cloud Run revision with its own `DATABASE_URL` secret.

This repository uses Prisma migrations in `packages/api/prisma/migrations`.
Do not use `supabase db push` for the application schema: it manages the
separate `supabase/migrations` history and is not the deployment path here.

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
- `Conversation` has a partial unique index
  (`Conversation_one_system_group_per_venue_key`) that permits only one system
  group per venue while allowing any number of custom groups. It lives in
  migration `20260809220000_mark_system_conversations` and is intentionally
  omitted from `schema.prisma`.
