/**
 * Tenant isolation defaults on and cannot be disabled in production. Keep this
 * lookup dynamic so values loaded by Nest's ConfigModule are observed
 * consistently by guards and Prisma.
 */
export function tenantIsolationEnforced(): boolean {
  const disabled = process.env['TENANT_ISOLATION_ENFORCED'] === 'false';
  if (disabled && process.env.NODE_ENV === 'production') {
    throw new Error('TENANT_ISOLATION_ENFORCED cannot be false in production');
  }
  return !disabled;
}
