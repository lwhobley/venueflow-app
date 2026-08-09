import { afterEach, describe, expect, it } from 'vitest';
import { tenantIsolationEnforced } from './tenant-isolation-config';

const original = process.env.TENANT_ISOLATION_ENFORCED;

afterEach(() => {
  if (original === undefined) delete process.env.TENANT_ISOLATION_ENFORCED;
  else process.env.TENANT_ISOLATION_ENFORCED = original;
});

describe('tenantIsolationEnforced', () => {
  it('fails closed unless explicitly disabled', () => {
    delete process.env.TENANT_ISOLATION_ENFORCED;
    expect(tenantIsolationEnforced()).toBe(true);

    process.env.TENANT_ISOLATION_ENFORCED = 'false';
    expect(tenantIsolationEnforced()).toBe(false);
  });
});
