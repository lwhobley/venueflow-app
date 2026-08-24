import { describe, expect, it, vi } from 'vitest';
import { ProfileService } from './profile.service';

describe('ProfileService.getProfile', () => {
  it('prefers a venued profile over an older venueless one when no venue is requested', async () => {
    // Signup creates a venueless profile before any venue exists; registering
    // a venue creates a second, venued profile for the same user. Callers
    // that check `.venue` (requireVenueProfile, requireManagerProfile) must
    // see the real membership, not fail because the older venueless row won.
    const venuedProfile = { id: 'profile-venue', userId: 'user-1', venueId: 'venue-1', venue: { id: 'venue-1' } };
    const prisma = {
      profile: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(venuedProfile) // the venued lookup
          .mockResolvedValueOnce({ id: 'profile-signup', userId: 'user-1', venueId: null, venue: null }),
      },
    } as any;
    const service = new ProfileService(prisma);

    const result = await service.getProfile({ sub: 'user-1', venueId: null } as any);

    expect(result).toBe(venuedProfile);
    expect(prisma.profile.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', venueId: { not: null } }),
      }),
    );
  });

  it('falls back to a venueless profile when the user genuinely has no venue', async () => {
    const signupProfile = { id: 'profile-signup', userId: 'user-1', venueId: null, venue: null };
    const prisma = {
      profile: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null) // no venued profile
          .mockResolvedValueOnce(signupProfile),
      },
    } as any;
    const service = new ProfileService(prisma);

    const result = await service.getProfile({ sub: 'user-1', venueId: null } as any);

    expect(result).toBe(signupProfile);
    expect(prisma.profile.findFirst).toHaveBeenCalledTimes(2);
  });

  it('looks up a specific venue directly when one is requested', async () => {
    const profile = { id: 'profile-venue', userId: 'user-1', venueId: 'venue-2', venue: { id: 'venue-2' } };
    const prisma = { profile: { findFirst: vi.fn().mockResolvedValue(profile) } } as any;
    const service = new ProfileService(prisma);

    const result = await service.getProfile({ sub: 'user-1', venueId: null } as any, 'venue-2');

    expect(result).toBe(profile);
    expect(prisma.profile.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', venueId: 'venue-2' }),
      }),
    );
  });
});
