import { describe, expect, it } from 'vitest';
import { getTenantVenueId, runWithoutTenant, runWithTenant } from './tenant-context';

describe('tenant context', () => {
  it('temporarily clears tenant scope for trusted account-level work and restores it afterward', async () => {
    await runWithTenant('venue-1', async () => {
      expect(getTenantVenueId()).toBe('venue-1');
      await runWithoutTenant(async () => {
        expect(getTenantVenueId()).toBeUndefined();
        await Promise.resolve();
        expect(getTenantVenueId()).toBeUndefined();
      });
      expect(getTenantVenueId()).toBe('venue-1');
    });
  });
});
