import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { VenueScopeInterceptor } from './venue-scope.interceptor';

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
});
