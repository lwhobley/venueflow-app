import { describe, expect, it, vi } from 'vitest';
import { resolveVenueSubscriptionStatus } from './subscription-status';
import type { PrismaService } from '../prisma/prisma.service';

function fakePrisma(subscriptionStatus: string | null, trialEndsAt?: Date | null): PrismaService {
  return {
    subscription: {
      findFirst: async () =>
        subscriptionStatus ? { id: 'sub_1', status: subscriptionStatus, trialEndsAt: trialEndsAt ?? null } : null,
      updateMany: async () => ({ count: 1 }),
    },
    venue: {
      updateMany: async () => ({ count: 1 }),
    },
  } as unknown as PrismaService;
}

describe('resolveVenueSubscriptionStatus', () => {
  it('returns the venue status directly when it is non-terminal', async () => {
    const result = await resolveVenueSubscriptionStatus(fakePrisma(null), {
      venueId: 'v1',
      venueStatus: 'active',
    });
    expect(result).toBe('active');
  });

  it('takes the fast path for active venues without querying the subscription row', async () => {
    const findFirst = vi.fn();
    const prisma = { subscription: { findFirst } } as unknown as PrismaService;
    const result = await resolveVenueSubscriptionStatus(prisma, { venueId: 'v1', venueStatus: 'active' });
    expect(result).toBe('active');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the latest subscription record when the venue status is terminal', async () => {
    const result = await resolveVenueSubscriptionStatus(fakePrisma('active'), {
      venueId: 'v1',
      venueStatus: 'expired',
    });
    expect(result).toBe('active');
  });

  it('reports trialing when there is no status but the trial is still active', async () => {
    const result = await resolveVenueSubscriptionStatus(fakePrisma(null), {
      venueId: 'v1',
      venueStatus: null,
      trialEndsAt: new Date(Date.now() + 60_000),
    });
    expect(result).toBe('trialing');
  });

  it('expires a venue trial once the trial end has passed', async () => {
    const result = await resolveVenueSubscriptionStatus(fakePrisma('trialing', new Date(Date.now() - 60_000)), {
      venueId: 'v1',
      venueStatus: 'trialing',
    });
    expect(result).toBe('expired');
  });

  it('returns expired when there is no status and the trial has expired', async () => {
    const result = await resolveVenueSubscriptionStatus(fakePrisma(null), {
      venueId: 'v1',
      venueStatus: null,
      trialEndsAt: new Date(Date.now() - 60_000),
    });
    expect(result).toBe('expired');
  });
});
