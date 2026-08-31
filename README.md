# Venue Wrangler

Venue Wrangler is a native iOS/Android venue ops app built with Expo Router, NestJS, and Prisma.

## Role model

- Admin/owner/manager: full visibility and edit access for schedule, floor plan, staff, requests, and live operations
- Staff/server: personal time clock punching, own hours, request flows, read-only schedule visibility, and **operating** the floor during service — seating and clearing the waitlist and changing table status. They cannot **design** the floor: plan edits, table merges/splits, and reservation/waitlist table assignments stay manager-only.

The floor split is deliberate: a host seating guests is not a manager. The
enforced matrix is pinned by `floor.controller.spec.ts` ("FloorController role
matrix") so this description and the code cannot drift apart — the two
destructive actions available to the lowest-privilege role (removing a waitlist
party, changing table status) are recorded in the audit log.

## What works now

- NestJS-backed auth bootstrap
- Venue assignment
- Precise GPS geofenced clock-in and clock-out
- Manager/admin live clock board
- Weekly schedule calendar
- Staff request flows for add/drop shifts, time off, and two-week availability
- Floor plan and table management with drag-and-drop editor for admins/managers
- Staff management screen for admins/managers to add people and assign roles to a venue
- Profile page shortcut to open staff management for privileged roles
- Billing shell with Stripe-backed venue subscriptions

## Local setup

> **Do not keep the working copy inside OneDrive (or another sync client).**
> OneDrive's Files On-Demand converts `node_modules` entries into reparse
> points. Metro's file crawler treats those as symlinks and skips them, so a
> bundle fails with `Unable to resolve module expo-router/entry` for a file
> that plainly exists on disk — both `expo start --web` and `expo export` break.
> Re-syncing ~87k files after `npm ci` also stretches a warm 45-second test run
> to well over an hour. Clone to a local path such as `C:\dev\`.

1. `npm install --legacy-peer-deps` (the `--legacy-peer-deps` flag is required; see `.npmrc`).
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your local NestJS server endpoint (e.g. `http://localhost:4000/api`).
3. Set up the local NestJS server inside `packages/api` (see `packages/api/README.md`).
4. In another terminal: `npm start` (Expo).
5. Test the sign-in flow, geofenced clock actions, and role-specific screens.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | NestJS API endpoint the client connects to | required |
| `EXPO_PUBLIC_BILLING_ENABLED` | Enables the subscription gate. Production EAS profiles set this to `true`. | `false` locally |

## Quality gates

- `npm run typecheck` — strict TypeScript, must be clean.
- `npm test` — API and shared-library Vitest suite with enforced coverage thresholds.
- `npm run test:ui -- --coverage` — app/component recovery-path test and repository-wide UI coverage ratchet.

## Production deploy

1. **Deploy the NestJS Backend** (for example, to Google Cloud Run):
   - Set `DATABASE_URL` to the Supabase pooler connection and `JWT_SECRET` in the serving service. Configure `DATABASE_DIRECT_URL` on the dedicated Cloud Run migration job.
   - Deploy immutable images through `.github/workflows/deploy-api.yml`; it runs migrations before updating service traffic.
   - Set `CORS_ORIGINS` to explicit web origins such as `https://venuewrangler.com,https://www.venuewrangler.com`; do not use `*` with credentialed CORS.
2. **Point the build at prod**: set `EXPO_PUBLIC_API_URL` in `eas.json` to the deployed server URL. Also set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (iOS in-app purchases).
3. **Build & submit**:
   - `eas build -p ios --profile production`
   - `eas build -p android --profile production`
   - `eas submit -p ios --profile production`
   - `eas submit -p android --profile production`

> Auth: run `eas login` for local builds. For CI, set `EXPO_ACCESS_TOKEN` as a
> CI/environment secret — never commit it to `eas.json` (this repo is public).

## Backend

- NestJS server backed by Prisma and PostgreSQL on Supabase, deployed to Cloud Run
- Push notifications registered via `POST /v1/push/token` and stored in the database

## Floor sync

- Seed a sample floor plan from the Floor Editor if you need demo tables
- Admin/manager can save and publish floor changes
- Staff can view the floor but cannot edit it
