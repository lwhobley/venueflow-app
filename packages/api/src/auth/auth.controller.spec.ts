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

describe('AuthController recovery and logout safety', () => {
  it('returns the same success response when reset-email delivery fails', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: 'staff@example.com',
          profile: { fullName: 'Test Staff' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const email = { sendOrThrow: vi.fn().mockRejectedValue(new Error('provider down')) };
    const authService = {
      generateOneTimeCode: vi.fn().mockReturnValue('12345678'),
      hashOneTimeCode: vi.fn().mockReturnValue('hashed-code'),
    };
    const controller = new AuthController(prisma as any, {} as any, email as any, authService as any);

    await expect(controller.forgotPassword(
      { ip: '127.0.0.1' } as any,
      { email: 'staff@example.com' },
    )).resolves.toEqual({ ok: true });
  });

  it('consumes a password-reset code once across concurrent attempts', async () => {
    let codeHash: string | null = 'hashed-code';
    let transactionTail = Promise.resolve();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      user: {
        findUnique: vi.fn(async () => ({
          id: 'user-1',
          passwordResetCodeHash: codeHash,
          passwordResetExpiresAt: new Date(Date.now() + 60_000),
        })),
        update: vi.fn(async () => {
          codeHash = null;
          return {};
        }),
      },
      passwordCredential: { upsert: vi.fn().mockResolvedValue({}) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          passwordResetCodeHash: codeHash,
          passwordResetExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
      $transaction: vi.fn(async (callback: (db: typeof tx) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          return await callback(tx);
        } finally {
          release();
        }
      }),
    };
    const authService = {
      hashPassword: vi.fn().mockResolvedValue({ salt: 'salt', hash: 'new-hash' }),
      hashOneTimeCode: vi.fn().mockReturnValue('hashed-code'),
      oneTimeCodeHashesMatch: vi.fn((stored: string, candidate: string) => stored === candidate),
    };
    const controller = new AuthController(prisma as any, {} as any, {} as any, authService as any);
    const request = { ip: '127.0.0.1' } as any;
    const body = { email: 'staff@example.com', code: '12345678', newPassword: 'password123' };

    const results = await Promise.allSettled([
      controller.resetPassword(request, body),
      controller.resetPassword(request, body),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.passwordCredential.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid reset code before running the password KDF', async () => {
    const hashPassword = vi.fn();
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          passwordResetCodeHash: 'stored-code',
          passwordResetExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const authService = {
      hashPassword,
      hashOneTimeCode: vi.fn().mockReturnValue('wrong-code'),
      oneTimeCodeHashesMatch: vi.fn().mockReturnValue(false),
    };
    const controller = new AuthController(prisma as any, {} as any, {} as any, authService as any);

    await expect(controller.resetPassword(
      { ip: '127.0.0.1' } as any,
      { email: 'staff@example.com', code: 'bad-code', newPassword: 'password123' },
    )).rejects.toThrow('invalid or expired');
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('does not issue an unfiltered push-token deletion without a profile id', async () => {
    const prisma = {
      session: {
        delete: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      pushToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const controller = new AuthController(prisma as any, {} as any, {} as any, {} as any);
    const user = { sub: 'user-1', sid: 'session-1', profileId: undefined } as any;

    await controller.logout(user);
    await controller.logoutAll(user);

    expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { id: 'session-1' } });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });
});
