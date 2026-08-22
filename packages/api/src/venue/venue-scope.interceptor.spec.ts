import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { defer, firstValueFrom, of } from 'rxjs';
import { VenueScopeInterceptor } from './venue-scope.interceptor';
import { getTenantVenueId, runWithoutTenant, runWithTenant } from '../prisma/tenant-context';

function contextFor(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('VenueScopeInterceptor', () => {
  it('fails closed when an explicit venue has no active membership', async () => {
    const prisma = { profile: { findFirst: vi.fn().mockResolvedValue(null) } } as any;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const interceptor = new VenueScopeInterceptor(prisma, reflector);
    const request = { user: { sub: 'user-1' }, headers: { 'x-venue-id': 'venue-foreign' } };
    const next = { handle: vi.fn(() => of('ok')) };

    await expect(interceptor.intercept(contextFor(request), next)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.profile.findFirst).toHaveBeenCalledTimes(1);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('uses first active membership only when no venue was explicitly requested', async () => {
    const profile = {
      id: 'profile-1', fullName: 'Manager', venueId: 'venue-1', role: 'manager', allAccess: false,
      membershipStatus: 'active', trialEndsAt: null,
      venue: { id: 'venue-1', name: 'Venue', subscriptionStatus: 'active' },
    };
    const prisma = {
      profile: { findFirst: vi.fn().mockResolvedValue(profile) },
      subscription: { findFirst: vi.fn().mockResolvedValue(null) },
    } as any;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const interceptor = new VenueScopeInterceptor(prisma, reflector);
    const request: any = { user: { sub: 'user-1' }, headers: {} };
    const next = { handle: vi.fn(() => of('ok')) };

    const observable = await interceptor.intercept(contextFor(request), next);
    expect(request.venueScope).toMatchObject({ venueId: 'venue-1', profileId: 'profile-1' });
    expect(observable).toBeDefined();
  });

  it('brackets deferred handler execution with the resolved tenant context', async () => {
    const prisma = {} as any;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const interceptor = new VenueScopeInterceptor(prisma, reflector);
    const request: any = {
      user: { sub: 'user-1' },
      headers: {},
      venueScope: {
        profileId: 'profile-1',
        fullName: 'Manager',
        venueId: 'venue-1',
        venueName: 'Venue',
        role: 'manager',
        allAccess: false,
        subscriptionStatus: 'active',
        trialEndsAt: null,
      },
    };
    const next = {
      handle: vi.fn(() => of(getTenantVenueId())),
    };

    await runWithoutTenant(async () => {
      const observable = await interceptor.intercept(contextFor(request), next);
      await expect(firstValueFrom(observable)).resolves.toBe('venue-1');
      expect(getTenantVenueId()).toBeUndefined();
    });
  });

  it('unsets tenant context during deferred execution when @SkipVenueScope is active', async () => {
    const prisma = {} as any;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as any;
    const interceptor = new VenueScopeInterceptor(prisma, reflector);
    const request: any = {
      user: { sub: 'user-1' },
      headers: {},
    };
    const next = {
      handle: vi.fn(() => defer(() => of(getTenantVenueId()))),
    };

    await runWithTenant('venue-1', async () => {
      const observable = await interceptor.intercept(contextFor(request), next);
      await expect(firstValueFrom(observable)).resolves.toBeUndefined();
      expect(getTenantVenueId()).toBe('venue-1');
    });
  });
});
