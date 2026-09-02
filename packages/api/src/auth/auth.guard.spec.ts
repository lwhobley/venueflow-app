import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getTenantVenueId, runWithoutTenant } from '../prisma/tenant-context';
import { AuthGuard } from './auth.guard';
import { ALLOW_UNVERIFIED_EMAIL_KEY, IS_PUBLIC_KEY } from './public.decorator';

// Every case below authenticates with this token; the default session fixture
// carries its hash so the guard's token-binding check passes.
const DEFAULT_TOKEN = 'token-1';
const DEFAULT_TOKEN_HASH = createHash('sha256').update(DEFAULT_TOKEN).digest('hex');

function makeContext(token: string, venueId?: string) {
  const request = {
    headers: { authorization: `Bearer ${token}`, ...(venueId ? { 'x-venue-id': venueId } : {}) },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function makeGuard(options?: {
  payload?: any;
  session?: any;
  profile?: any;
  isPublic?: boolean;
  allowUnverifiedEmail?: boolean;
}) {
  const jwt = {
    verifyAsync: vi.fn().mockResolvedValue(
      options?.payload ?? {
        sub: 'user-1',
        sid: 'session-1',
        email: 'token@example.com',
        name: 'Token User',
        profileId: 'profile-stale',
        venueId: 'venue-stale',
        role: 'owner',
        allAccess: true,
      },
    ),
  } as any;
  const reflector = {
    getAllAndOverride: vi.fn().mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return options?.isPublic ?? false;
      if (key === ALLOW_UNVERIFIED_EMAIL_KEY) return options?.allowUnverifiedEmail ?? false;
      return false;
    }),
  } as any;
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue(
        options?.session ?? {
          userId: 'user-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          tokenHash: DEFAULT_TOKEN_HASH,
          user: { emailVerifiedAt: new Date() },
        },
      ),
    },
    profile: {
      findUnique: vi.fn().mockResolvedValue(
        options && 'profile' in options
          ? options.profile
          : {
              id: 'profile-live',
              email: 'live@example.com',
              fullName: 'Live User',
              role: 'staff',
              allAccess: false,
              trialEndsAt: new Date('2026-01-01T00:00:00Z'),
              venueId: 'venue-live',
              venue: { name: 'Live Venue', subscriptionStatus: 'active' },
            },
      ),
      findFirst: vi.fn().mockImplementation((args: any) => prisma.profile.findUnique(args)),
    },
  } as any;
  return { guard: new AuthGuard(jwt, reflector, prisma), prisma, jwt };
}

describe('AuthGuard', () => {
  it('refreshes request claims from the live profile before controllers run', async () => {
    const { guard, prisma } = makeGuard();
    const context = makeContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-1' } }));
    expect(prisma.profile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
    expect(context.switchToHttp().getRequest().user).toMatchObject({
      email: 'live@example.com',
      name: 'Live User',
      profileId: 'profile-live',
      venueId: 'venue-live',
      venueName: 'Live Venue',
      role: 'staff',
      allAccess: false,
      venueStatus: 'active',
    });
  });

  it('clears privilege claims when the live profile is missing', async () => {
    const { guard } = makeGuard({ profile: null });
    const context = makeContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest().user).toMatchObject({
      profileId: undefined,
      role: undefined,
      allAccess: false,
      venueId: null,
    });
  });

  it('rejects an explicit venue without an active membership and never binds it', async () => {
    const { guard } = makeGuard({ profile: null });

    await runWithoutTenant(async () => {
      await expect(guard.canActivate(makeContext('token-1', 'venue-foreign'))).rejects.toThrow(
        'You do not have an active membership at the requested venue.',
      );
      expect(getTenantVenueId()).toBeUndefined();
    });
  });

  it('prefers a venued profile over an older venueless one when no venue is requested', async () => {
    // A user can hold both a venueless profile (created at signup) and a
    // venued one (created afterward). With no x-venue-id header and no
    // venueId claim on the token, the guard must not fall back to picking
    // whichever profile is oldest — that would silently leave tenant
    // isolation unbound for a request that is really scoped to a venue.
    const { guard, prisma } = makeGuard({
      payload: { sub: 'user-1', sid: 'session-1', venueId: undefined },
    });

    await guard.canActivate(makeContext('token-1'));

    expect(prisma.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ venueId: { not: null } }) }),
    );
  });

  it('rejects when a stored token hash does not match the presented bearer token', async () => {
    const { guard } = makeGuard({
      session: {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        tokenHash: 'wrong-hash',
      },
    });

    await expect(guard.canActivate(makeContext('token-1'))).rejects.toThrow('Session is no longer valid. Please sign in again.');
  });

  it('rejects a session row with no stored token hash', async () => {
    const { guard } = makeGuard({
      session: {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        tokenHash: null,
      },
    });

    await expect(guard.canActivate(makeContext(DEFAULT_TOKEN))).rejects.toThrow('Session is no longer valid. Please sign in again.');
  });

  it('rejects a session created more than one day ago even if its stored expiry is later', async () => {
    const { guard } = makeGuard({
      session: {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1),
        tokenHash: DEFAULT_TOKEN_HASH,
      },
    });

    await expect(guard.canActivate(makeContext(DEFAULT_TOKEN))).rejects.toThrow('Session is no longer valid. Please sign in again.');
  });

  it('blocks unverified accounts from protected application routes', async () => {
    const { guard } = makeGuard({
      session: {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        tokenHash: DEFAULT_TOKEN_HASH,
        user: { emailVerifiedAt: null },
      },
    });
    await expect(guard.canActivate(makeContext(DEFAULT_TOKEN))).rejects.toThrow(/Verify your email/);
  });

  it('allows an unverified account only on explicitly exempted auth routes', async () => {
    const { guard } = makeGuard({
      allowUnverifiedEmail: true,
      session: {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        tokenHash: DEFAULT_TOKEN_HASH,
        user: { emailVerifiedAt: null },
      },
    });
    await expect(guard.canActivate(makeContext(DEFAULT_TOKEN))).resolves.toBe(true);
  });
});
