# NestJS Backend Migration

The current production app still talks to Convex. The NestJS backend now lives in
`packages/api` and should be rolled out module-by-module behind configuration so
TestFlight/App Review does not lose working data flows.

## Target Stack

- NestJS HTTP API in `packages/api`
- Prisma ORM
- PostgreSQL
- JWT bearer auth
- RevenueCat/Stripe webhooks stay server-side
- Expo app gradually moves from `useQuery(api.x.y)` / `useMutation(api.x.y)` to
  React Query hooks that call `/api/v1/...`

## First Porting Order

1. Auth/session/profile: `app.getMe`, `bootstrapProfile`, `deleteMyAccount`
2. Venue/settings/subscription gate
3. Dashboard/notifications
4. Scheduling/time clock
5. Staff/invites/chat
6. Floor/reservations/tables
7. POS/payroll/reports
8. CRM/guests/billing/webhooks

## Ported So Far

- **Auth/profile/venue**: `getMe`, `bootstrapProfile`, `updateVenue`, `deleteMyAccount`
- **Time clock**: `getClockBoard`, `getMyTimeClock`, `clockIn`, `clockOut`
- **Staff requests**: `listStaffRequests`, `createStaffRequest`, `reviewStaffRequest`
- **Staff roster**: `listVenueStaff`, `upsertVenueStaff`, `deactivateVenueStaff`

Shared infrastructure backing these:

- `AuthGuard` registered globally (`APP_GUARD`); opt out with `@Public()`.
- `VenueScopeInterceptor` (`APP_INTERCEPTOR`) resolves profile + venue once per
  request into `request.venueScope`; read it with `@VenueScope()`. Routes that
  run before a profile exists use `@SkipVenueScope()`.
- `SubscriptionGuard` + `@RequireSubscription()` / `@RequireSubscription('paid')`
  mirror `requireActiveSubscription` / `requirePaidSubscription`.

New Prisma models added for these endpoints: `TimeEntry`, `BlackoutDate`. Run
`npm run prisma:migrate:dev -w @venue-wrangler/api` against a database to create
the migration before deploying.

## Convex Data Migration To Railway Postgres

The Prisma schema now includes the remaining Convex app tables and widened
reservation fields in migration
`packages/api/prisma/migrations/20260606185000_complete_convex_surface`.

Railway runs Prisma migrations during deploy via `railway.toml`:

```toml
releaseCommand = "npm run release -w @venue-wrangler/api"
```

For a manual migration against the linked Railway database, refresh Railway CLI
auth and run:

```bash
railway login
railway run npm run prisma:migrate:deploy -w @venue-wrangler/api
```

Then import a Convex export directory containing `table.json` arrays or
`table.jsonl` files. The importer preserves Convex `_id` values as Postgres
primary keys so existing cross-table references stay intact.

```bash
railway run npm run api:convex:import -- /path/to/convex-export --dry-run
railway run npm run api:convex:import -- /path/to/convex-export
```

The importer handles the app tables defined in `convex/schema.ts`, including
bar inventory, reservation integrations, manager goals/events, payroll exports,
payment methods, invoices, invites, and table state history. Keep Convex live
until each client surface is switched to REST routes and the imported row counts
are verified against the Convex export.

## Convex Function Surface To Replace

The Nest API exposes `/api/v1/compatibility/convex-surface` so we can track the
remaining Convex contract from the running backend.

## Rollout Rules

- Keep Convex deployed until a screen has equivalent Nest routes, tests, and
  client hooks.
- Use tenant-scoped authorization for every venue route. The client may pass a
  venue id for selection, but the server must verify the caller belongs to that
  venue before reading or writing.
- Preserve soft-delete behavior for guest, reservation, and CRM records.
- Keep account deletion available at `Profile > Account deletion` throughout the
  migration.
