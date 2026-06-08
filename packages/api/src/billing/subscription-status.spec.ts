import { resolveVenueSubscriptionStatus } from './subscription-status';
import type { PrismaService } from '../prisma/prisma.service';

function fakePrisma(subscriptionStatus: string | null): PrismaService {
  return {
    subscription: {
      findFirst: async () => (subscriptionStatus ? { status: subscriptionStatus } : null),
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

  it('returns null when there is no status and the trial has expired', async () => {
    const result = await resolveVenueSubscriptionStatus(fakePrisma(null), {
      venueId: 'v1',
      venueStatus: null,
      trialEndsAt: new Date(Date.now() - 60_000),
    });
    expect(result).toBeNull();
  });
});
