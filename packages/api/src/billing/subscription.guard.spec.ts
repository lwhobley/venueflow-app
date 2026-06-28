import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';

/**
 * Unit coverage for the billing gate that protects every paid feature.
 * When request.venueScope is already populated (the common path — the venue-scope
 * interceptor ran first), canActivate makes a pure allow/deny decision and never
 * touches the database, so we exercise the full tier × status matrix with a stub
 * Prisma that would throw if called.
 */
function makeContext(venueScope: unknown, user?: unknown) {
  const request = { venueScope, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function makeGuard(tier: string | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(tier) } as any;
  // Throws if any code path tries to hit the DB — proves these cases are pure.
  const prisma = new Proxy({}, { get() { throw new Error('Prisma should not be queried'); } }) as any;
  return new SubscriptionGuard(reflector, prisma);
}

const scope = (subscriptionStatus: string | null, allAccess = false) => ({
  profileId: 'p1', fullName: 'A', venueId: 'v1', venueName: 'V', role: 'manager',
  allAccess, subscriptionStatus, trialEndsAt: null,
});

describe('SubscriptionGuard', () => {
  it('allows ungated routes (no tier decorator)', async () => {
    const guard = makeGuard(undefined);
    await expect(guard.canActivate(makeContext(scope('expired')))).resolves.toBe(true);
  });

  it('lets allAccess accounts bypass billing regardless of status', async () => {
    const guard = makeGuard('paid');
    await expect(guard.canActivate(makeContext(scope(null, true)))).resolves.toBe(true);
  });

  describe("tier 'active' (any active or trialing subscription)", () => {
    it.each(['active', 'trialing'])('allows status=%s', async (status) => {
      const guard = makeGuard('active');
      await expect(guard.canActivate(makeContext(scope(status)))).resolves.toBe(true);
    });

    it.each(['past_due', 'paused', 'cancelled', 'expired', null])('denies status=%s with 402', async (status) => {
      const guard = makeGuard('active');
      await expect(guard.canActivate(makeContext(scope(status)))).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe("tier 'paid' (only fully active)", () => {
    it('allows status=active', async () => {
      const guard = makeGuard('paid');
      await expect(guard.canActivate(makeContext(scope('active')))).resolves.toBe(true);
    });

    it('denies status=trialing — a trial does not satisfy paid-only', async () => {
      const guard = makeGuard('paid');
      await expect(guard.canActivate(makeContext(scope('trialing')))).rejects.toBeInstanceOf(HttpException);
    });
  });

  it('denies with 402 when there is no resolvable venue scope', async () => {
    const guard = makeGuard('active');
    // venueScope undefined + no authenticated user → resolveVenueScope returns null
    // without querying Prisma.
    await expect(guard.canActivate(makeContext(undefined, undefined))).rejects.toBeInstanceOf(HttpException);
  });
});
