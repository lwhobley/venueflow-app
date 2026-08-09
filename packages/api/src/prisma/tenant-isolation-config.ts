/**
 * Tenant isolation is fail-closed: only the explicit literal "false" disables
 * it for an emergency rollback. Keep this lookup dynamic so values loaded by
 * Nest's ConfigModule are observed consistently by guards and Prisma.
 */
export function tenantIsolationEnforced(): boolean {
  return process.env['TENANT_ISOLATION_ENFORCED'] !== 'false';
}
