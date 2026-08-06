import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { AppController } from './app.controller';
import { ProfileService } from './profile.service';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('AppController invite preview', () => {
  it('rate-limits and rejects an invalid invite without exposing details', async () => {
    const prisma = { invite: { findFirst: vi.fn().mockResolvedValue(null) } };
    const controller = new AppController(prisma as any, {} as any, {} as any);

    await expect(controller.previewInvite({ ip: '127.0.0.1' } as any, 'bad-code'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(assertWithinSharedRateLimit).toHaveBeenCalled();
  });

  it('returns only the intended public invite metadata', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const prisma = {
      invite: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'invite-1',
          venueId: 'venue-1',
          role: 'staff',
          jobTitle: 'Server',
          expiresAt,
        }),
      },
      venue: { findUnique: vi.fn().mockResolvedValue({ name: 'Test Venue' }) },
    };
    const controller = new AppController(prisma as any, {} as any, {} as any);

    await expect(controller.previewInvite({ ip: '127.0.0.1' } as any, 'VW-ABC123')).resolves.toEqual({
      valid: true,
      venueName: 'Test Venue',
      role: 'staff',
      jobTitle: 'Server',
      expiresAt: expiresAt.getTime(),
    });
  });
});

describe('AppController redeem-my-invite', () => {
  // The no-invite fallback adopts an unclaimed roster profile by deleting the
  // caller's own profile. A caller who already belongs to a venue must never
  // reach it: doing so would tear them out of their venue and, for a sole
  // owner, orphan it — bypassing the last-admin guard on account deletion.
  it('does not delete the profile of a caller who already belongs to a venue', async () => {
    const existingProfile = {
      id: 'profile-owner',
      email: 'owner@example.com',
      fullName: 'Olive Owner',
      role: 'owner',
      jobTitle: 'Owner',
      venueId: 'venue-a',
      allAccess: false,
      venue: { id: 'venue-a', name: 'Venue A', latitude: 1, longitude: 2, geofenceRadiusM: 150 },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@example.com', emailVerifiedAt: new Date() }) },
      profile: {
        findUnique: vi.fn().mockResolvedValue(existingProfile),
        findFirst: vi.fn().mockImplementation((args: any) => {
          if (args?.where?.userId) return Promise.resolve(existingProfile);
          return Promise.resolve({ id: 'profile-roster', venueId: 'venue-b', venue: { id: 'venue-b' } });
        }),
        findMany: vi.fn().mockResolvedValue([{ id: 'profile-owner', venueId: 'venue-a', venue: { id: 'venue-a', name: 'Venue A' }, role: 'owner' }]),
        delete: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...existingProfile, id: 'profile-roster', venueId: 'venue-b' }),
      },
      invite: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const profiles = new ProfileService(prisma as any);
    const controller = new AppController(prisma as any, {} as any, profiles);

    const result = await controller.redeemMyInvite({ sub: 'user-owner' } as any);

    expect(result.redeemed).toBe(false);
    expect(result).toMatchObject({ venue: { id: 'venue-a' } });
    expect(prisma.profile.delete).not.toHaveBeenCalled();
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('adopts an unclaimed roster profile when the caller has no venue', async () => {
    const adopted = {
      id: 'profile-roster',
      email: 'new@example.com',
      fullName: 'Nina New',
      role: 'staff',
      jobTitle: 'Server',
      venueId: 'venue-b',
      allAccess: false,
      venue: { id: 'venue-b', name: 'Venue B', latitude: 3, longitude: 4, geofenceRadiusM: 150 },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'new@example.com', emailVerifiedAt: new Date() }) },
      profile: {
        findUnique: vi.fn().mockResolvedValue({ id: 'profile-temp', venueId: null, venue: null }),
        findFirst: vi.fn().mockImplementation((args: any) => {
          if (args?.where?.userId === 'user-new') return Promise.resolve({ id: 'profile-temp', venueId: null, venue: null });
          return Promise.resolve({ id: 'profile-roster', venueId: 'venue-b', venue: { id: 'venue-b' } });
        }),
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        update: vi.fn().mockResolvedValue(adopted),
      },
      invite: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    const profiles = new ProfileService(prisma as any);
    const controller = new AppController(prisma as any, {} as any, profiles);

    const result = await controller.redeemMyInvite({ sub: 'user-new' } as any);

    expect(result.redeemed).toBe(true);
    expect(result).toMatchObject({ venue: { id: 'venue-b' } });
    expect(prisma.profile.delete).toHaveBeenCalledWith({ where: { id: 'profile-temp' } });
    expect(prisma.profile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'profile-roster' }, data: { userId: 'user-new' } }),
    );
  });
});
