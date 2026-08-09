import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped tenant context. Holds the authenticated venueId so the Prisma
 * tenant-isolation extension can scope queries without every call site passing
 * venueId by hand.
 *
 * Set once per request (e.g. from AuthGuard after the JWT is verified) via
 * `enterTenant(venueId)`; read by the extension via `getTenantVenueId()`. When
 * no context is set (auth flows, webhooks, system tasks, tests) the extension is
 * a no-op, so this is purely additive defense-in-depth.
 */
const storage = new AsyncLocalStorage<{ venueId?: string }>();

/** Run `fn` with the tenant context bound. Preferred for background/system tasks. */
export function runWithTenant<T>(venueId: string, fn: () => T): T {
  return storage.run({ venueId }, fn);
}

/**
 * Run a narrowly scoped, explicitly trusted cross-tenant operation. Callers
 * must still constrain every query by a user/account identifier. This exists
 * for membership discovery and account lifecycle work that cannot operate
 * correctly after a single venue has been bound to the request.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/**
 * Bind the tenant context for the remainder of the current async execution.
 * Use from a guard/interceptor where wrapping the downstream call isn't practical.
 */
export function enterTenant(venueId: string): void {
  storage.enterWith({ venueId });
}

/** The venueId bound to the current async context, if any. */
export function getTenantVenueId(): string | undefined {
  return storage.getStore()?.venueId;
}
