import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService invited signup lifecycle', () => {
  it('reserves a valid invite and creates an inactive venue membership until email verification', async () => {
    const invite = {
      id: 'invite-1',
      venueId: 'venue-1',
      email: null,
      phone: null,
      role: 'staff',
      jobTitle: 'Server',
    };
    const profile = {
      id: 'profile-1',
      userId: 'user-1',
      email: 'staff@example.com',
      fullName: 'Test Staff',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Server',
      membershipStatus: 'pending',
      venue: { id: 'venue-1', name: 'Test Venue' },
    };
    const tx = {
      invite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      profile: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(profile),
      },
    };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ emailVerifiedAt: null }) },
      invite: { findFirst: vi.fn().mockResolvedValue(invite) },
      session: { create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AuthService(prisma as never);

    const result = await service.issueSession(
      'user-1',
      'staff@example.com',
      'Test Staff',
      'shared-manager-token',
    );

    expect(prisma.invite.findFirst).toHaveBeenCalledOnce();
    expect(tx.profile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        venueId: 'venue-1',
        role: 'staff',
        jobTitle: 'Server',
        membershipStatus: 'pending',
      }),
    }));
    expect(tx.invite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { usedBy: 'profile-1' },
    });
    expect(result.profile).toBe(profile);
  });
});
