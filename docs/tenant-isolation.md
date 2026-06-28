# Tenant Isolation

Venue Wrangler currently enforces tenant isolation in the NestJS API rather than through Supabase Row Level Security policies. The production data path should stay server-mediated unless database-level RLS is added and tested.

The API-level controls are:

- `AuthGuard` protects routes by default and requires a revocable session row.
- `VenueScopeInterceptor` resolves the caller's active profile and venue once per request.
- Controllers must use `request.venueScope.venueId` or a manager profile lookup as the source of truth, never a client-supplied `venueId`.
- Public webhook routes must authenticate with a per-connection secret and rate limit by IP and venue.

Before enabling any direct Supabase client access, add SQL policies and tests that prove users can only read and mutate rows for their active venue.
