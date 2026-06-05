/**
 * Roles that may manage venue-level configuration. Mirrors isAdminRole in
 * convex/app.ts so the migration keeps identical authorization semantics.
 */
export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'owner' || role === 'manager';
}
