/**
 * Roles that may manage venue-level configuration.
 */
export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'owner' || role === 'manager';
}
