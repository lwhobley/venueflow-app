# Tenant Isolation

Venue Wrangler currently enforces tenant isolation in the NestJS API rather than through Supabase Row Level Security policies. The production data path should stay server-mediated unless database-level RLS is added and tested.

The API-level controls are:

- `AuthGuard` protects routes by default and requires a revocable session row.
- `VenueScopeInterceptor` resolves the caller's active profile and venue once per request.
- Controllers must use `request.venueScope.venueId` or a manager profile lookup as the source of truth, never a client-supplied `venueId`.
- Public webhook routes must authenticate with a per-connection secret and rate limit by IP and venue.

Before enabling any direct Supabase client access, add SQL policies and tests that prove users can only read and mutate rows for their active venue.

## Database-layer backstop (optional, inert until enabled)

As defense-in-depth for the manual `where: { venueId }` controls above, a Prisma
Client extension can scope venue-owned models to the request's tenant
automatically. It is **inert until explicitly enabled**, so landing it changes
nothing in production on its own.

| File | Responsibility |
|------|----------------|
| `prisma/tenant-context.ts` | `AsyncLocalStorage` holding the request's `venueId` (`enterTenant`, `runWithTenant`, `getTenantVenueId`). |
| `prisma/tenant-scope.ts` | Pure logic: the venue-scoped model set + `scopeArgs()` (AND venueId into `where`, force it onto creates). Exhaustively unit-tested. |
| `prisma/tenant-isolation.extension.ts` | The Prisma extension; no-op without a tenant context or for unscoped models/operations. |
| `prisma/tenant-scope.spec.ts` | DB-free unit tests incl. security invariants (hostile venueId can't widen scope). |
| `prisma/tenant-isolation.integration.spec.ts` | End-to-end isolation proof against real Postgres (skips without a test DB). |

### Design notes

- **AND, never replace.** A caller-supplied `venueId` is AND-ed with the tenant
  predicate, so a hostile `where: { venueId: other }` matches nothing instead of
  escaping scope.
- **Creates force venueId.** A `create`/`createMany` can never write into another tenant.
- **Unique-keyed ops are pass-through.** `findUnique`/`update`/`delete`/`upsert`
  require a unique `where`; injecting a non-unique `venueId` is invalid for them,
  so they are intentionally **not** auto-scoped and still rely on the existing
  call-site `venueId` checks. This is the main residual gap.
- **Inert by default.** No tenant context ⇒ no-op. Auth flows, webhooks, and
  system/background tasks (which legitimately cross venues) are unaffected.

### Enablement (reviewed cutover — NOT enabled here)

1. **Apply the extension** in `prisma.service.ts` (expose the `$extends` client, or
   adopt it as the injected Prisma provider — see the Prisma + NestJS extension guide).
2. **Bind the context per request** in `auth.guard.ts`, right after `request.user`
   is set: `if (payload.venueId) enterTenant(payload.venueId);`

Recommended rollout: enable in staging, run the integration suite against a
seeded DB, then enable per-module rather than all at once.
