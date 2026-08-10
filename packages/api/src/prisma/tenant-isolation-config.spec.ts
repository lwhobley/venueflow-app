import { afterEach, describe, expect, it } from 'vitest';
import { tenantIsolationEnforced } from './tenant-isolation-config';

const original = process.env.TENANT_ISOLATION_ENFORCED;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (original === undefined) delete process.env.TENANT_ISOLATION_ENFORCED;
  else process.env.TENANT_ISOLATION_ENFORCED = original;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('tenantIsolationEnforced', () => {
  it('fails closed unless explicitly disabled', () => {
    delete process.env.TENANT_ISOLATION_ENFORCED;
    expect(tenantIsolationEnforced()).toBe(true);

    process.env.TENANT_ISOLATION_ENFORCED = 'false';
    expect(tenantIsolationEnforced()).toBe(false);
  });

  it('refuses to disable tenant isolation in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.TENANT_ISOLATION_ENFORCED = 'false';

    expect(() => tenantIsolationEnforced()).toThrow('cannot be false in production');
  });
});
