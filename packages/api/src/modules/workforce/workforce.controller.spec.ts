import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkforceController } from './workforce.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkforceController invite check email', () => {
  // Outer-level mocks (calls made outside the $transaction): the top-level
  // invite/profile lookups used only by the phone-only path and by
  // reportStaleInviteStatus's used/expired/not_found fallback.
  const outerFindInvite = vi.fn();
  const outerFindProfile = vi.fn();
  // Inner (tx-scoped) mocks: everything the email path does happens inside
  // the advisory-locked transaction.
  const txFindInvite = vi.fn();
  const txUpdateInvite = vi.fn();
  const txCreateInvite = vi.fn();
  const txFindProfile = vi.fn();
  const executeLock = vi.fn();
  const sendOrThrow = vi.fn().mockResolvedValue(undefined);

  const prisma = {
    invite: { findFirst: outerFindInvite },
    profile: { findFirst: outerFindProfile },
    $transaction: vi.fn((callback: any) => callback({
      $executeRaw: executeLock,
      invite: { findFirst: txFindInvite, update: txUpdateInvite, create: txCreateInvite },
      profile: { findFirst: txFindProfile },
    })),
  };
  const email = { sendOrThrow };
  const config = {
    get: vi.fn((key: string) => key === 'APP_WEB_URL' ? 'https://app.example.com/' : undefined),
  };
  const request = { ip: '127.0.0.1' };

  beforeEach(() => {
    vi.clearAllMocks();
    sendOrThrow.mockResolvedValue(undefined);
  });

  it('rotates and emails the secure account link for an existing redeemable invite', async () => {
    txFindInvite.mockResolvedValue({
      id: 'invite-1',
      email: 'staff@example.com',
      usedBy: null,
      expiresAt: new Date(Date.now() + 60_000),
      jobTitle: 'Server',
      venue: { name: 'Test Venue' },
    });
    txUpdateInvite.mockImplementation(async ({ data }: any) => ({
      jobTitle: 'Server',
      venue: { name: 'Test Venue' },
      ...data,
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: ' Staff@Example.com ' }))
      .resolves.toEqual({ status: 'found', emailSent: true });
    expect(txUpdateInvite).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invite-1' },
      data: expect.objectContaining({ tokenHash: expect.any(String) }),
    }));
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      to: 'staff@example.com',
      text: expect.stringContaining('https://app.example.com/join#invite='),
    }));
  });

  it('mints an invite token for a legacy unclaimed roster profile', async () => {
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    txCreateInvite.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'invite-2',
      usedBy: null,
      venue: { name: 'Legacy Venue' },
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'found', emailSent: true });
    expect(txCreateInvite).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        venueId: 'venue-1',
        email: 'legacy@example.com',
        role: 'staff',
        jobTitle: 'Bartender',
        tokenHash: expect.any(String),
      }),
    }));
    expect(sendOrThrow).toHaveBeenCalledOnce();
    expect(executeLock).toHaveBeenCalledOnce();
  });

  it('rotates the already-created invite for a concurrent second check instead of reusing its unrecoverable plaintext', async () => {
    // Under hash-only-at-rest storage, a second (serialized-by-lock) request
    // can no longer read back the first request's plaintext token — it must
    // mint its own rotation of the same row rather than "reuse" a token it
    // has no way to recover.
    txFindInvite.mockResolvedValue({
      id: 'invite-2',
      email: 'legacy@example.com',
      usedBy: null,
      expiresAt: new Date(Date.now() + 60_000),
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    txUpdateInvite.mockImplementation(async ({ data }: any) => ({
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
      ...data,
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'found', emailSent: true });
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(txUpdateInvite).toHaveBeenCalledOnce();
  });

  it('mints a fresh invite for an unclaimed roster profile even when a used invite exists for the email', async () => {
    // The redeemable-only tx lookup finds nothing (the only invite on file
    // is already used), so it must fall through to the roster/mint branch
    // instead of reporting "used" and stranding a legitimate roster row.
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Legacy Venue' },
    });
    txCreateInvite.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'invite-3',
      usedBy: null,
      venue: { name: 'Legacy Venue' },
    }));
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'legacy@example.com' }))
      .resolves.toEqual({ status: 'found', emailSent: true });
    expect(txCreateInvite).toHaveBeenCalledOnce();
  });

  it('reports "used" when a used invite exists and there is no roster fallback', async () => {
    txFindInvite.mockResolvedValue(null); // redeemable-only tx lookup: none
    txFindProfile.mockResolvedValue(null); // no unclaimed roster row to fall back to
    outerFindInvite.mockResolvedValue({ usedBy: 'user-1', expiresAt: new Date(Date.now() + 60_000) }); // stale-status lookup
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'gone@example.com' }))
      .resolves.toEqual({ status: 'used' });
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });

  it('reports "expired" when only an expired invite exists and there is no roster fallback', async () => {
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue(null);
    outerFindInvite.mockResolvedValue({ usedBy: null, expiresAt: new Date(Date.now() - 60_000) });
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'stale@example.com' }))
      .resolves.toEqual({ status: 'expired' });
  });

  it('reports "not_found" when there is no invite history and no roster fallback', async () => {
    txFindInvite.mockResolvedValue(null);
    txFindProfile.mockResolvedValue(null);
    outerFindInvite.mockResolvedValue(null);
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { email: 'nobody@example.com' }))
      .resolves.toEqual({ status: 'not_found' });
  });

  it('does not claim that an email was sent for phone-only roster matches', async () => {
    outerFindInvite.mockResolvedValue(null);
    outerFindProfile.mockResolvedValue({
      id: 'profile-1',
      venueId: 'venue-1',
      role: 'staff',
      jobTitle: 'Bartender',
      venue: { name: 'Test Venue' },
    });
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { phone: '555-0100' }))
      .resolves.toEqual({ status: 'found', emailSent: false });
    expect(txCreateInvite).not.toHaveBeenCalled();
    expect(sendOrThrow).not.toHaveBeenCalled();
  });

  it('reports phone-only "not_found" when there is no invite or roster match', async () => {
    outerFindInvite.mockResolvedValue(null);
    outerFindProfile.mockResolvedValue(null);
    const controller = new WorkforceController(prisma as any, email as any, config as any);

    await expect((controller as any).inviteCheck(request, { phone: '555-0199' }))
      .resolves.toEqual({ status: 'not_found' });
  });
});
