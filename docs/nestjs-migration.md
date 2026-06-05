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
