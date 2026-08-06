# Tenant Isolation

Venue Wrangler enforces tenant isolation in the NestJS API and keeps the production data path server-mediated. Every public table also has Supabase Row Level Security enabled with no client policies, while table, sequence, and function privileges are revoked from `anon` and `authenticated`. This makes the Supabase Data API fail closed; the Cloud Run API connects with its database role and remains the only application data path.

The API-level controls are:

- `AuthGuard` protects routes by default and requires a revocable session row.
- `VenueScopeInterceptor` resolves the caller's active profile and venue once per request.
- Controllers must use `request.venueScope.venueId` or a manager profile lookup as the source of truth, never a client-supplied `venueId`.
- Public webhook routes must authenticate with a per-connection secret and rate limit by IP and venue.

Before enabling any direct Supabase client access, add narrowly scoped SQL policies and tests that prove users can only read and mutate rows for their active venue. Do not grant broad table access or disable the fail-closed RLS backstop.

## Database-layer backstop (enforced by default)

As defense-in-depth for the manual `where: { venueId }` controls above, a Prisma
Client extension scopes venue-owned models to the request's tenant
automatically. It is inert without a bound tenant context (auth flows,
webhooks, system/background tasks), and can be disabled instantly by setting
`TENANT_ISOLATION_ENFORCED=false` if it is ever suspected of causing a
production issue.

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

### Enablement (fail-closed by default)

Both pieces are active unless `TENANT_ISOLATION_ENFORCED` is explicitly set to
the literal string `"false"`.

1. **`prisma.service.ts`** — unless disabled, the service applies the
   extension via `this.$extends(tenantIsolationExtension())` and wraps itself in
   a `Proxy` that delegates Prisma calls to the extended client while keeping
   Nest lifecycle hooks on the wrapper. This preserves the `PrismaService`
   injection token across the codebase. `$transaction`'s `tx` callback is also
   extension-aware, so transactional writes are scoped.
2. **`auth.guard.ts`** — unless disabled, when the token carries a `venueId`,
   `enterTenant(venueId)` binds the AsyncLocalStorage tenant context for the
   rest of the request. Tokens without a venueId (auth flows, system tasks)
   stay unscoped, which is correct.

Rollback: set `TENANT_ISOLATION_ENFORCED=false` in the environment to disable
instantly if the extension is ever suspected of causing a production issue.
