import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { AppController } from './app.controller';
import { ProfileService } from './profile.service';
import { getTenantVenueId, runWithTenant } from '../../prisma/tenant-context';

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

describe('AppController multi-venue invariants', () => {
  it('returns the active venue join code only through the manager endpoint', async () => {
    const profiles = {
      requireManagerProfile: vi.fn().mockResolvedValue({
        venueId: 'venue-1', venue: { code: 'VW-ABCDEFGHJK' },
      }),
    };
    const controller = new AppController({} as any, {} as any, profiles as any);

    await expect(controller.getVenueJoinCode({ sub: 'manager-1' } as any))
      .resolves.toEqual({ code: 'VW-ABCDEFGHJK' });
  });

  it('rotates the active venue join code to a new high-entropy human code', async () => {
    const prisma = {
      venue: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const profiles = {
      requireManagerProfile: vi.fn().mockResolvedValue({ venueId: 'venue-1', venue: { code: 'VW-OLD' } }),
    };
    const controller = new AppController(prisma as any, {} as any, profiles as any);

    const result = await controller.rotateVenueJoinCode({ sub: 'manager-1' } as any);

    expect(result.code).toMatch(/^VW-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    expect(prisma.venue.update).toHaveBeenCalledWith({ where: { id: 'venue-1' }, data: { code: result.code } });
  });

  it('clears the current tenant only while verifying membership in the target venue', async () => {
    const targetProfile = {
      id: 'profile-b', userId: 'user-1', venueId: 'venue-b', role: 'owner', allAccess: false,
      membershipStatus: 'active', fullName: 'Owner Olivia', email: 'owner@example.com', jobTitle: 'Owner',
      venue: { id: 'venue-b', name: 'Venue B', latitude: 1, longitude: 2, geofenceRadiusM: 150 },
    };
    const profiles = {
      requireVenueProfile: vi.fn(async () => {
        expect(getTenantVenueId()).toBeUndefined();
        return targetProfile;
      }),
      isEmailVerified: vi.fn().mockResolvedValue(true),
      listUserVenues: vi.fn().mockResolvedValue([{ id: 'venue-b', name: 'Venue B', role: 'owner', profileId: 'profile-b' }]),
    };
    const controller = new AppController({} as any, {} as any, profiles as any);

    const result = await runWithTenant('venue-a', () => controller.switchVenue({ sub: 'user-1' } as any, { venueId: 'venue-b' }));

    expect(profiles.requireVenueProfile).toHaveBeenCalledWith(expect.objectContaining({ sub: 'user-1' }), 'venue-b');
    expect(result).toMatchObject({ profile: { venueId: 'venue-b' }, venue: { id: 'venue-b' } });
  });

  it('serializes venue registration by user and checks the cap under that lock', async () => {
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      profile: {
        findMany: vi.fn().mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ venueId: `venue-${index}` }))),
      },
      venue: { create: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const profiles = {
      ensureUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      isEmailVerified: vi.fn().mockResolvedValue(true),
    };
    const controller = new AppController(prisma, {} as any, profiles as any);

    await expect(controller.registerVenue(
      { sub: 'user-1', email: 'owner@example.com' } as any,
      { businessName: 'Sixth Venue', staffRange: '1-15' } as any,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$executeRaw.mock.calls[0]?.[1]).toBe('register-venue:user-1');
    expect(prisma.profile.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
    expect(prisma.venue.create).not.toHaveBeenCalled();
  });

  it('deletes the caller\'s venueless signup profile once a venue profile is created', async () => {
    // Signup always creates a venueless Profile row. Registering a venue then
    // creates a second, venued row for the same user. If the venueless row is
    // left behind, "oldest matching profile" fallbacks elsewhere (see
    // profile.service.ts / auth.guard.ts) can pick it over the real venue
    // membership and silently disable venue-scoped behavior.
    const existingProfile = { id: 'profile-signup', userId: 'user-1', venueId: null, email: 'owner@example.com', fullName: 'Owner' };
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      profile: {
        findMany: vi.fn().mockResolvedValue([]),
        // Distinguish the duplicate-venue-name check (has a `venue` filter)
        // from the plain existingProfile lookup by userId only.
        findFirst: vi.fn().mockImplementation((args: any) =>
          Promise.resolve(args?.where?.venue ? null : existingProfile)),
        create: vi.fn().mockResolvedValue({ id: 'profile-venue', venueId: 'venue-new', userId: 'user-1' }),
        delete: vi.fn().mockResolvedValue(existingProfile),
        count: vi.fn().mockResolvedValue(1),
      },
      venue: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'venue-new', name: 'New Venue' }),
      },
      subscription: { create: vi.fn().mockResolvedValue({}) },
      staffOnboardingTask: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      team: { upsert: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const profiles = {
      ensureUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      isEmailVerified: vi.fn().mockResolvedValue(true),
      listUserVenues: vi.fn().mockResolvedValue([{ id: 'venue-new', name: 'New Venue', role: 'admin', profileId: 'profile-venue' }]),
    };
    const controller = new AppController(prisma, {} as any, profiles as any);

    await controller.registerVenue(
      { sub: 'user-1', email: 'owner@example.com' } as any,
      { businessName: 'New Venue', staffRange: '1-15' } as any,
    );

    expect(prisma.profile.delete).toHaveBeenCalledWith({ where: { id: 'profile-signup' } });
  });

  it('does not delete an existing profile that already belongs to another venue', async () => {
    // A user registering an additional venue (multi-venue) already has a
    // venued profile as their "existingProfile" match; that one must survive.
    const existingProfile = { id: 'profile-other-venue', userId: 'user-1', venueId: 'venue-a', email: 'owner@example.com', fullName: 'Owner' };
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      profile: {
        findMany: vi.fn().mockResolvedValue([{ venueId: 'venue-a' }]),
        findFirst: vi.fn().mockImplementation((args: any) =>
          Promise.resolve(args?.where?.venue ? null : existingProfile)),
        create: vi.fn().mockResolvedValue({ id: 'profile-venue-b', venueId: 'venue-b', userId: 'user-1' }),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
      },
      venue: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'venue-b', name: 'Second Venue' }),
      },
      subscription: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({ id: 'sub-multi' }),
      },
      staffOnboardingTask: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      team: { upsert: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const profiles = {
      ensureUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      isEmailVerified: vi.fn().mockResolvedValue(true),
      listUserVenues: vi.fn().mockResolvedValue([]),
    };
    const controller = new AppController(prisma, {} as any, profiles as any);

    await controller.registerVenue(
      { sub: 'user-1', email: 'owner@example.com' } as any,
      { businessName: 'Second Venue', staffRange: '1-15' } as any,
    );

    expect(prisma.profile.delete).not.toHaveBeenCalled();
  });

  it('checks last-admin safety for every venue before deleting a multi-venue account', async () => {
    const profiles = [
      { id: 'profile-a', email: 'owner@example.com', fullName: 'Owner', role: 'owner', venueId: 'venue-a', membershipStatus: 'active' },
      { id: 'profile-b', email: 'owner@example.com', fullName: 'Owner', role: 'owner', venueId: 'venue-b', membershipStatus: 'active' },
    ];
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@example.com' }), deleteMany: vi.fn() },
      profile: {
        findMany: vi.fn().mockResolvedValue(profiles),
        count: vi.fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1),
        deleteMany: vi.fn(),
      },
      pushToken: { deleteMany: vi.fn() }, availability: { deleteMany: vi.fn() },
      timeEntry: { updateMany: vi.fn() }, scheduleShift: { updateMany: vi.fn() },
      session: { deleteMany: vi.fn() }, authAccount: { deleteMany: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const controller = new AppController(prisma, {} as any, {} as any);

    await expect(controller.deleteMyAccount({ sub: 'user-1' } as any)).rejects.toThrow(
      'Transfer venue ownership or confirm deletion',
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects deletion when caller is the sole owner/admin of a single-member venue', async () => {
    const profiles = [
      { id: 'profile-sole', email: 'owner@example.com', fullName: 'Sole Owner', role: 'owner', venueId: 'venue-single', membershipStatus: 'active' },
    ];
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@example.com' }), deleteMany: vi.fn() },
      profile: {
        findMany: vi.fn().mockResolvedValue(profiles),
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn(),
      },
      pushToken: { deleteMany: vi.fn() }, availability: { deleteMany: vi.fn() },
      timeEntry: { updateMany: vi.fn() }, scheduleShift: { updateMany: vi.fn() },
      session: { deleteMany: vi.fn() }, authAccount: { deleteMany: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const controller = new AppController(prisma, {} as any, {} as any);

    await expect(controller.deleteMyAccount({ sub: 'user-1' } as any)).rejects.toThrow(
      'Transfer venue ownership or confirm deletion',
    );
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes an owned venue only after explicit final-owner confirmation', async () => {
    const profiles = [
      { id: 'profile-sole', email: 'owner@example.com', fullName: 'Sole Owner', role: 'owner', venueId: 'venue-single', membershipStatus: 'active' },
    ];
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@example.com' }), deleteMany: vi.fn() },
      profile: {
        findMany: vi.fn().mockResolvedValue(profiles),
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      venue: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([{ id: 'venue-single', name: 'Single Venue' }]),
      },
      chatImage: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      venueDocument: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      checklistCompletion: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      objectDeletionJob: { create: vi.fn() },
      retainedTimeEntry: { createMany: vi.fn() },
      pushToken: { deleteMany: vi.fn() }, availability: { deleteMany: vi.fn() },
      timeEntry: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      scheduleShift: { updateMany: vi.fn() },
      session: { deleteMany: vi.fn() }, authAccount: { deleteMany: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const email = { send: vi.fn().mockResolvedValue(undefined) };
    const controller = new AppController(prisma, email as any, {} as any);

    await expect(controller.deleteMyAccount(
      { sub: 'user-1' } as any,
      { deleteOwnedVenues: true },
    )).resolves.toEqual({ ok: true });

    expect(prisma.profile.deleteMany).toHaveBeenCalledWith({ where: { venueId: { in: ['venue-single'] } } });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.venue.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['venue-single'] } } });
    expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
      where: { profileId: 'profile-sole' },
      data: { profileFullName: 'deleted_user_profile-sole', isOpen: false },
    });
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('uses set-based archival without an arbitrary row-count refusal', async () => {
    const profiles = [
      { id: 'profile-sole', email: 'owner@example.com', fullName: 'Sole Owner', role: 'owner', venueId: 'venue-single', membershipStatus: 'active' },
    ];
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@example.com' }), deleteMany: vi.fn() },
      profile: {
        findMany: vi.fn().mockResolvedValue(profiles),
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn(),
      },
      venue: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      chatImage: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      venueDocument: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      checklistCompletion: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      objectDeletionJob: { create: vi.fn() },
      retainedTimeEntry: { createMany: vi.fn() },
      pushToken: { deleteMany: vi.fn() }, availability: { deleteMany: vi.fn() },
      timeEntry: { updateMany: vi.fn() },
      scheduleShift: { updateMany: vi.fn() },
      session: { deleteMany: vi.fn() }, authAccount: { deleteMany: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const controller = new AppController(prisma, { send: vi.fn() } as any, {} as any);

    await expect(controller.deleteMyAccount(
      { sub: 'user-1' } as any,
      { deleteOwnedVenues: true },
    )).resolves.toEqual({ ok: true });

    expect(prisma.chatImage.count).not.toHaveBeenCalled();
    expect(prisma.venue.deleteMany).toHaveBeenCalled();
    expect(prisma.user.deleteMany).toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 30_000 });
  });

  it('archives every employee wage record before the venue cascade destroys them', async () => {
    const profiles = [
      { id: 'profile-sole', email: 'owner@example.com', fullName: 'Sole Owner', role: 'owner', venueId: 'venue-single', membershipStatus: 'active' },
    ];
    // Two entries belonging to a DIFFERENT employee — the case that matters.
    // TimeEntry.venue is onDelete: Cascade, so without the archive step these
    // rows disappear when the owner deletes their own account.
    const otherStaffEntries = [
      {
        id: 'te-1', venueId: 'venue-single', profileId: 'profile-bailey', profileFullName: null,
        clockInAt: new Date('2026-01-02T09:00:00Z'), clockOutAt: new Date('2026-01-02T17:00:00Z'),
        isOpen: false, breaks: null, createdAt: new Date('2026-01-02T09:00:00Z'),
        profile: { fullName: 'Bartender Bailey', email: 'bailey@example.com' },
      },
      {
        id: 'te-2', venueId: 'venue-single', profileId: 'profile-snap', profileFullName: 'Snapshot Only',
        clockInAt: new Date('2026-01-03T09:00:00Z'), clockOutAt: null,
        isOpen: true, breaks: null, createdAt: new Date('2026-01-03T09:00:00Z'),
        profile: null,
      },
    ];
    let timeEntryPage = 0;
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@example.com' }), deleteMany: vi.fn() },
      profile: {
        findMany: vi.fn().mockResolvedValue(profiles),
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      venue: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([{ id: 'venue-single', name: 'Single Venue' }]),
      },
      chatImage: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      venueDocument: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      checklistCompletion: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      objectDeletionJob: { create: vi.fn() },
      retainedTimeEntry: { createMany: vi.fn() },
      pushToken: { deleteMany: vi.fn() }, availability: { deleteMany: vi.fn() },
      // First call returns the page, second returns empty to end the loop.
      timeEntry: {
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(async () => (timeEntryPage++ === 0 ? otherStaffEntries : [])),
        count: vi.fn().mockResolvedValue(0),
      },
      scheduleShift: { updateMany: vi.fn() },
      session: { deleteMany: vi.fn() }, authAccount: { deleteMany: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const controller = new AppController(prisma, { send: vi.fn() } as any, {} as any);

    await controller.deleteMyAccount({ sub: 'user-1' } as any, { deleteOwnedVenues: true });

    const archiveSql = prisma.$executeRaw.mock.calls.at(-1)[0];
    const archiveText = archiveSql.strings.join('');
    expect(archiveText).toContain('INSERT INTO "RetainedTimeEntry"');
    // Pseudonymize the departing account's own rows only. Co-workers keep their
    // real name/email — an anonymized wage record cannot satisfy FLSA §516.2,
    // so blanket-anonymizing the venue would retain the rows and still lose the
    // compliance value they exist for.
    expect(archiveText).toContain("'deleted_user_' || t.\"profileId\"");
    expect(archiveText).toContain('CASE WHEN t."profileId" IS NOT NULL');
    expect(archiveText).toContain('ELSE t."profileFullName" END');
    expect(archiveText).toContain('ELSE p."email" END');
    // And the archive must happen before the cascade, not after.
    const archiveOrder = prisma.$executeRaw.mock.invocationCallOrder.at(-1);
    const cascadeOrder = prisma.venue.deleteMany.mock.invocationCallOrder[0];
    expect(archiveOrder).toBeLessThan(cascadeOrder);
  });

  it('closes a still-running punch with a real clock-out so the final shift stays payable', async () => {
    const profiles = [
      { id: 'profile-leaver', email: 'leaver@example.com', fullName: 'Lee Leaver', role: 'staff', venueId: 'venue-other', membershipStatus: 'active' },
    ];
    const prisma: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUnique: vi.fn().mockResolvedValue({ email: 'leaver@example.com' }), deleteMany: vi.fn() },
      profile: {
        findMany: vi.fn().mockResolvedValue(profiles),
        // Not the last owner/admin anywhere, so no venue is deleted: the time
        // entries survive at a venue this user merely worked at.
        count: vi.fn().mockResolvedValue(3),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      venue: { deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      objectDeletionJob: { create: vi.fn() },
      retainedTimeEntry: { createMany: vi.fn() },
      pushToken: { deleteMany: vi.fn() }, availability: { deleteMany: vi.fn() },
      timeEntry: { updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      scheduleShift: { updateMany: vi.fn() },
      session: { deleteMany: vi.fn() }, authAccount: { deleteMany: vi.fn() },
      // The surviving venue gets its member count resynced after the profile goes.
      team: { upsert: vi.fn() },
    };
    prisma.$transaction = vi.fn(async (callback: any) => callback(prisma));
    const controller = new AppController(prisma, { send: vi.fn() } as any, {} as any);

    await controller.deleteMyAccount({ sub: 'user-1' } as any);

    // Flipping isOpen to false while leaving clockOutAt null makes the row
    // invisible to payroll (which filters clockOutAt: { not: null }) and
    // unreachable by a correction request once profileId is nulled — the
    // employee's last partial shift would silently never be paid.
    const closeCall = prisma.timeEntry.updateMany.mock.calls.find(
      ([args]: any[]) => args?.where?.clockOutAt === null,
    );
    expect(closeCall).toBeDefined();
    expect(closeCall[0].where.profileId).toEqual({ in: ['profile-leaver'] });
    expect(closeCall[0].data.clockOutAt).toBeInstanceOf(Date);
    expect(closeCall[0].data.isOpen).toBe(false);
    // It must run before the de-identification pass, which only sets isOpen.
    const closeOrder = prisma.timeEntry.updateMany.mock.invocationCallOrder[0];
    const renameCall = prisma.timeEntry.updateMany.mock.calls.findIndex(
      ([args]: any[]) => typeof args?.data?.profileFullName === 'string',
    );
    expect(closeOrder).toBeLessThan(prisma.timeEntry.updateMany.mock.invocationCallOrder[renameCall]);
  });
});
