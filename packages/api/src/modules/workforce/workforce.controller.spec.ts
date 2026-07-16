import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkforceController } from './workforce.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkforceController invite check email', () => {
  const findInvite = vi.fn();
  const createInvite = vi.fn();
  const findProfile = vi.fn();
  const sendOrThrow = vi.fn();
  const prisma = {
    invite: { findFirst: findInvite, create: createInvite },
    profile: { findFirst: findProfile },
  };
  const email = { sendOrThrow };
  const config = {
    get: vi.fn((key: string) => key === 'APP_WEB_URL' ? 'https://app.example.com/' : undefined),
  };
  const request = { ip: '127.0.0.1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emails the secure account link for an existing invitation', async () => {
    findInvite.mockResolvedValue({
      id: 'invite-1',
      email: 'staff@example.com',
      token: 'secure-token',
      usedBy: null,
      expiresAt: new Date(Date.now() + 60_000),
      jobTitle: 'Server',
      venue: { name: 'Test Venue' },
    });
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: ' Staff@Example.com ' }))
      .resolves.toEqual({ status: 'found', emailSent: true });
    expect(sendOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      to: 'staff@example.com',
      text: expect.stringContaining('https://app.example.com/join?invite=secure-token'),
    }));
  });

  it('mints an invite token for a legacy unclaimed roster profile', async () => {
    findInvite.mockResolvedValue(null);
    findProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    createInvite.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'invite-2',
      usedBy: null,
      venue: { name: 'Legacy Venue' },
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'found', emailSent: true });
    expect(createInvite).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        venueId: 'venue-1',
        email: 'legacy@example.com',
        role: 'staff',
        jobTitle: 'Bartender',
      }),
    }));
    expect(sendOrThrow).toHaveBeenCalledOnce();
  });

  it('does not claim that an email was sent for phone-only roster matches', async () => {
    findInvite.mockResolvedValue(null);
    findProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Test Venue' },
    });
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { phone: '555-0100' }))
      .resolves.toEqual({ status: 'found', emailSent: false });
    expect(createInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });
});
