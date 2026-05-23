# Venue Wrangler

Venue Wrangler is a native iOS/Android venue ops app built with Expo Router and Convex.

## Role model

- Admin/owner/manager: full visibility and edit access for schedule, floor plan, staff, requests, and live operations
- Staff: read-only floor/schedule visibility, personal time clock punching, own hours, and request flows

## What works now

- Convex-backed auth bootstrap
- Venue assignment
- Precise GPS geofenced clock-in and clock-out
- Manager/admin live clock board
- Weekly schedule calendar
- Staff request flows for add/drop shifts, time off, and two-week availability
- Floor plan and table management with drag-and-drop editor for admins/managers
- Staff management screen for admins/managers to add people and assign roles to a venue
- Profile page shortcut to open staff management for privileged roles
- Billing shell with automatic 14-day trial state for new venues

## Local setup

1. `npm install --legacy-peer-deps` (the `--legacy-peer-deps` flag is required; see `.npmrc`).
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_CONVEX_URL` to your Convex deployment URL.
3. In one terminal: `npx convex dev` (keeps functions/types in sync with the backend).
4. In another terminal: `npm start` (Expo).
5. Test the sign-in flow, geofenced clock actions, and role-specific screens.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `EXPO_PUBLIC_CONVEX_URL` | Convex deployment the client connects to | required |
| `EXPO_PUBLIC_BILLING_ENABLED` | Enables the subscription gate. Keep `false` until a real in-app purchase provider is wired into `lib/a0-purchases-stub.tsx`. | `false` |

## Quality gates

- `npm run typecheck` — strict TypeScript, must be clean.
- `npm test` — Vitest unit suite (geofence anti-fraud rules, authorization role checks, billing state mapping).

## Production deploy

1. **Provision a production Convex deployment** (separate from dev):
   - `npx convex deploy` — this creates/pushes to your prod deployment and prints its URL.
2. **Point the build at prod**: set `EXPO_PUBLIC_CONVEX_URL` in `eas.json`'s `production.env` to that URL (currently a `REPLACE-with-prod-deployment` placeholder).
3. **Build & submit**:
   - `eas build -p ios --profile production`
   - `eas build -p android --profile production`
   - `eas submit -p ios --profile production`
   - `eas submit -p android --profile production`

> Auth: run `eas login` for local builds. For CI, set `EXPO_ACCESS_TOKEN` as a
> CI/environment secret — never commit it to `eas.json` (this repo is public).

## Backend

- Convex for auth, venue profiles, time clock data, floor plans, staff requests, and staff management
- Push notifications remain handled by Convex internal actions

## Floor sync

- Seed a sample floor plan from the Floor Editor if you need demo tables
- Admin/manager can save and publish floor changes
- Staff can view the floor but cannot edit it
