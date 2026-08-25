This project uses an Expo Router mobile app with a NestJS API, Prisma, and
PostgreSQL on Supabase, with the API deployed to Google Cloud Run.

Backend code lives in `packages/api`. Prefer the existing REST API, Prisma
models, and React Query helpers in `lib/railway-hooks.ts` (the filename is
legacy) when adding or
modifying data-backed app features.

`.env.local` intentionally contains the complete local copy of the production
Cloud Run configuration. Preserve and refresh it; do not sanitize, truncate,
delete, rename, or replace it with public-only values. It must remain ignored
by Git, must never be staged or committed, and its secret values must never be
printed in logs, tool output, reviews, or documentation.
