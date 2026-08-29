# Tenant Isolation

Venue Wrangler enforces tenant isolation in the NestJS API and keeps the production data path server-mediated. Every public table also has Supabase Row Level Security enabled with no client policies, while table, sequence, and function privileges are revoked from `anon` and `authenticated`. This makes the Supabase Data API fail closed; the Cloud Run API connects with its database role and remains the only application data path.

The API-level controls are:

- `AuthGuard` protects routes by default and requires a revocable session row.
- `VenueScopeInterceptor` resolves the caller's active profile and venue once per request.
- Controllers must use `request.venueScope.venueId` or a manager profile lookup as the source of truth, never a client-supplied `venueId`.
- Public webhook routes must authenticate with a per-connection secret and rate limit by IP and venue.

Before enabling any direct Supabase client access, add narrowly scoped SQL policies and tests that prove users can only read and mutate rows for their active venue. Do not grant broad table access or disable the fail-closed RLS backstop.

### Trust boundary decision (VW-23)

RLS is enabled on every public table, but no `CREATE POLICY` exists and no table has `FORCE ROW LEVEL SECURITY`. Postgres exempts a table's owner from RLS by default, and the Cloud Run API connects as that owning role — so RLS here does real work against the Supabase Data API path (which authenticates as `anon`/`authenticated`, both privilege-revoked) but does **not** constrain the API's own connection. **The NestJS API is the entire tenant-isolation trust boundary.** A leaked `DATABASE_URL` reads and writes every tenant; nothing at the database layer stops it.

This is a deliberate choice, not an oversight, made explicit here so it is revisited on purpose rather than discovered by accident:

- Adding `FORCE ROW LEVEL SECURITY` with per-tenant policies would make the database independently enforce isolation even against the API's own credential, at the cost of real engineering effort (a policy per venue-scoped table, a session variable carrying the current tenant, and tests proving the policies match `VENUE_SCOPED_MODELS` exactly) and a new failure mode (a policy bug either leaks data or blocks legitimate queries with no apparent bug in the calling code).
- The alternative — the one in effect today — is treating the API as the sole trust boundary and investing in credential hygiene instead: rotate `DATABASE_URL` on any suspected exposure, keep `DATABASE_DIRECT_URL` off every serving instance (already true — see `assert-database-target.mjs`), and monitor for anomalous direct-connection egress.

Revisit this if a second service, an analytics pipeline, or any other consumer ever needs its own direct database connection — at that point the API is no longer the only thing RLS would need to constrain, and the calculus above changes.

## Database-layer backstop (enforced by default)

As defense-in-depth for the manual `where: { venueId }` controls above, a Prisma
Client extension scopes venue-owned models to the request's tenant
automatically. It is inert without a bound tenant context (auth flows,
webhooks, system/background tasks). Production rejects startup when
`TENANT_ISOLATION_ENFORCED=false`; local and staging environments may use that
value temporarily for diagnosis.

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
- **Unique-keyed ops are scoped.** `findUnique`/`update`/`delete`/`upsert`
  merge `venueId` into unique filters so a hostile id from another tenant
  matches nothing.
- **Inert by default.** No tenant context ⇒ no-op. Auth flows, webhooks, and
  system/background tasks (which legitimately cross venues) are unaffected.

### Enablement (fail-closed by default)

Both pieces are active by default. The literal string `"false"` disables them
only when `NODE_ENV` is not `production`; production fails startup instead.

1. **`prisma.service.ts`** — unless disabled, the service applies the
   extension via `this.$extends(tenantIsolationExtension())` and wraps itself in
   a `Proxy` that delegates Prisma calls to the extended client while keeping
   Nest lifecycle hooks on the wrapper. This preserves the `PrismaService`
   injection token across the codebase. `$transaction`'s `tx` callback is also
   extension-aware, so transactional writes are scoped.
2. **`auth.guard.ts`** — binds tenant context from the caller's **live**
   venue membership (not a stale JWT `venueId` claim). Requests without an
   active membership stay unscoped, which is correct for auth/system routes.

Production incident response: roll back to the last known-good Cloud Run
revision. Do not disable the isolation layer in a production revision.
