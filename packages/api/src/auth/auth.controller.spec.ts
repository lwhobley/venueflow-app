import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';

vi.mock('../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('AuthController email invite signup', () => {
  it('requires terms acceptance for every new account', async () => {
    const controller = new AuthController(
      { user: { findUnique: vi.fn().mockResolvedValue(null) } } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect((controller as any).password(
      { ip: '127.0.0.1' },
      { email: 'staff@example.com', password: 'password123', flow: 'signUp' },
    )).rejects.toThrow('Accept the Terms of Service');
  });

  it('treats the emailed token as verification and issues a venue session', async () => {
    const verifiedAt = new Date();
    const userFindUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ emailVerifiedAt: verifiedAt });
    const userUpsert = vi.fn().mockResolvedValue({ id: 'user-1' });
    const passwordUpsert = vi.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: userFindUnique },
      invite: { findFirst: vi.fn().mockResolvedValue({ id: 'invite-1' }) },
      session: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback: any) => callback({
        user: { upsert: userUpsert },
        passwordCredential: { upsert: passwordUpsert },
      })),
    };
    const venue = {
      id: 'venue-1',
      name: 'Test Venue',
      latitude: 1,
      longitude: 2,
      geofenceRadiusM: 100,
      subscriptionStatus: 'trialing',
    };
    const profile = {
      id: 'profile-1',
      email: 'staff@example.com',
      fullName: 'Test Staff',
      role: 'staff',
      jobTitle: 'Server',
      venueId: venue.id,
      allAccess: false,
      trialEndsAt: null,
      venue,
    };
    const authService = {
      hashPassword: vi.fn().mockResolvedValue({ salt: 'salt', hash: 'hash' }),
      issueSession: vi.fn().mockResolvedValue({ session: { id: 'session-1' }, profile }),
    };
    const email = { send: vi.fn(), sendOrThrow: vi.fn() };
    const jwt = { signAsync: vi.fn().mockResolvedValue('jwt-token') };
    const controller = new AuthController(prisma as any, jwt as any, email as any, authService as any);

    const result = await (controller as any).password(
      { ip: '127.0.0.1' },
      {
        email: 'Staff@Example.com',
        password: 'password123',
        flow: 'signUp',
        fullName: 'Test Staff',
        inviteToken: 'emailed-token',
        termsAccepted: true,
      },
    );

    expect(userUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ email: 'staff@example.com', emailVerifiedAt: expect.any(Date) }),
    }));
    expect(authService.issueSession).toHaveBeenCalledWith(
      'user-1',
      'staff@example.com',
      'Test Staff',
      'emailed-token',
      undefined,
    );
    expect(result.profile.emailVerified).toBe(true);
    expect(result.profile.venueId).toBe('venue-1');
    expect(result.venue.name).toBe('Test Venue');
    expect(email.sendOrThrow).not.toHaveBeenCalled();
  });

  it('does not auto-verify email for a shareable manager-created invite (has a join code)', async () => {
    const userFindUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ emailVerifiedAt: null });
    const userUpsert = vi.fn().mockResolvedValue({ id: 'user-1' });
    const passwordUpsert = vi.fn().mockResolvedValue({});
    // The real query filters on `code: null` — a manager-created invite
    // (which always has a `code`) must never match this lookup, since its
    // raw token/link is returned to the manager and could be forwarded to
    // someone other than the invited address.
    const inviteFindFirst = vi.fn(async ({ where }: any) => (where.code === null ? null : { id: 'invite-1' }));
    const prisma = {
      user: { findUnique: userFindUnique },
      invite: { findFirst: inviteFindFirst },
      session: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback: any) => callback({
        user: { upsert: userUpsert },
        passwordCredential: { upsert: passwordUpsert },
      })),
    };
    const venue = {
      id: 'venue-1',
      name: 'Test Venue',
      latitude: 1,
      longitude: 2,
      geofenceRadiusM: 100,
      subscriptionStatus: 'trialing',
    };
    const profile = {
      id: 'profile-1',
      email: 'staff@example.com',
      fullName: 'Test Staff',
      role: 'staff',
      jobTitle: 'Server',
      venueId: venue.id,
      allAccess: false,
      trialEndsAt: null,
      venue,
    };
    const authService = {
      hashPassword: vi.fn().mockResolvedValue({ salt: 'salt', hash: 'hash' }),
      issueSession: vi.fn().mockResolvedValue({ session: { id: 'session-1' }, profile }),
      generateOneTimeCode: vi.fn().mockReturnValue('12345678'),
      hashOneTimeCode: vi.fn().mockReturnValue('hashed-code'),
    };
    const email = { send: vi.fn(), sendOrThrow: vi.fn().mockResolvedValue(undefined) };
    const jwt = { signAsync: vi.fn().mockResolvedValue('jwt-token') };
    const controller = new AuthController(prisma as any, jwt as any, email as any, authService as any);
    prisma.user = { ...prisma.user, update: vi.fn().mockResolvedValue({}) } as any;

    await (controller as any).password(
      { ip: '127.0.0.1' },
      {
        email: 'Staff@Example.com',
        password: 'password123',
        flow: 'signUp',
        fullName: 'Test Staff',
        inviteToken: 'shared-manager-token',
        termsAccepted: true,
      },
    );

    expect(userUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ email: 'staff@example.com' }),
    }));
    // Must NOT auto-verify: no emailVerifiedAt in the create payload.
    expect(userUpsert.mock.calls[0][0].create).not.toHaveProperty('emailVerifiedAt');
    // The normal verification-code email must still be sent since this
    // account was not auto-verified.
    expect(email.sendOrThrow).toHaveBeenCalled();
  });
});
