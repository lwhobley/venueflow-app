import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('./daily-brief-alerts', () => ({
  buildDailyBriefAlerts: vi.fn().mockReturnValue(['mock-alert']),
}));
vi.mock('./daily-brief-priority-actions', () => ({
  buildDailyBriefPriorityActions: vi.fn().mockReturnValue(['mock-priority-action']),
}));
vi.mock('./daily-brief-profitability', () => ({
  buildDailyBriefProfitabilityPulse: vi.fn().mockReturnValue({
    tone: 'good',
    headline: 'mock-headline',
    detail: 'mock-detail',
  }),
}));

import { OperationsController } from './operations.controller';
import { buildDailyBriefAlerts } from './daily-brief-alerts';
import { buildDailyBriefPriorityActions } from './daily-brief-priority-actions';
import { buildDailyBriefProfitabilityPulse } from './daily-brief-profitability';

function makeController() {
  const prisma = {
    profile: { findUnique: vi.fn().mockResolvedValue(null) },
    reservation: { findMany: vi.fn().mockResolvedValue([]) },
    managerGoal: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    venueEvent: { findMany: vi.fn().mockResolvedValue([]) },
    scheduleShift: { findMany: vi.fn().mockResolvedValue([]) },
    timeEntry: { findMany: vi.fn().mockResolvedValue([]) },
    staffRequest: { findMany: vi.fn().mockResolvedValue([]) },
    barInventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
    prepBoardItem: { findMany: vi.fn().mockResolvedValue([]) },
    posCheck: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    logbookEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
    },
    checklistTemplateItem: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    checklistCompletion: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  } as any;
  const mediaAccess = {
    createPath: vi.fn().mockResolvedValue('/v1/operations/checklist/photo/completion-1?token=tok'),
    assertToken: vi.fn().mockResolvedValue(undefined),
  } as any;
  const s3ImageService = {
    upload: vi.fn().mockResolvedValue('s3-key-1'),
    getPresignedUrl: vi.fn().mockResolvedValue('https://signed.example/img.jpg'),
  } as any;
  const controller = new OperationsController(prisma, mediaAccess, s3ImageService);
  return { controller, prisma, mediaAccess, s3ImageService };
}

function makeProfile(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'profile-1',
    userId: 'user-1',
    venueId: 'venue-1',
    role: 'manager',
    fullName: 'Morgan Manager',
    membershipStatus: 'active',
    venue: { timezone: null },
    ...overrides,
  };
}

const managerUser = { sub: 'user-1' } as any;
const staffUser = { sub: 'user-2' } as any;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OperationsController', () => {
  describe('authorization / profile guards', () => {
    it('rejects when the caller has no profile', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(null);

      await expect(controller.listLogbook(managerUser)).rejects.toThrow('Profile is not initialized');
    });

    it('rejects when the profile has no venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ venueId: null }));

      await expect(controller.listLogbook(managerUser)).rejects.toThrow('Profile is not initialized');
    });

    it('rejects an inactive membership', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ membershipStatus: 'removed' }));

      await expect(controller.listLogbook(managerUser)).rejects.toThrow('Profile is not active for this venue');
    });

    it('allows a null membershipStatus (legacy rows treated as active)', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ membershipStatus: null }));

      await expect(controller.listLogbook(managerUser)).resolves.toEqual({ entries: [] });
    });

    it('rejects a non-admin role from a manager-only endpoint', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ role: 'staff' }));

      await expect(controller.getManagerDashboard(staffUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows an admin role through a manager-only endpoint', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ role: 'admin' }));

      await expect(controller.getManagerDashboard(managerUser)).resolves.toBeDefined();
    });
  });

  describe('getManagerDashboard', () => {
    const now = new Date('2026-07-15T18:30:00.000Z');

    it('scopes every query to the caller venue and shapes the response', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const reservations = [
        // large party, upcoming within the week -> vip/large
        {
          id: 'rsv-large',
          guestName: 'Large Party',
          partySize: 10,
          reservationTime: new Date('2026-07-16T20:00:00.000Z'),
          tags: [],
          notes: null,
          specialRequests: null,
          status: 'confirmed',
        },
        // small party, VIP tag, upcoming within the week -> vip/large
        {
          id: 'rsv-vip',
          guestName: 'VIP Guest',
          partySize: 2,
          reservationTime: new Date('2026-07-17T20:00:00.000Z'),
          tags: ['VIP-regular'],
          notes: 'Prefers window seat',
          specialRequests: null,
          status: 'confirmed',
        },
        // today, small, not upcoming-VIP -> counted in todayReservations & total only
        {
          id: 'rsv-today',
          guestName: 'Today Guest',
          partySize: 4,
          reservationTime: new Date('2026-07-15T19:00:00.000Z'),
          tags: [],
          notes: null,
          specialRequests: null,
          status: 'confirmed',
        },
        // past reservation -> excluded from upcoming and today, counted in total
        {
          id: 'rsv-past',
          guestName: 'Past Guest',
          partySize: 2,
          reservationTime: new Date('2026-07-10T12:00:00.000Z'),
          tags: [],
          notes: null,
          specialRequests: null,
          status: 'confirmed',
        },
        // cancelled, within week -> excluded from vip/large
        {
          id: 'rsv-cancelled',
          guestName: 'Cancelled Guest',
          partySize: 12,
          reservationTime: new Date('2026-07-16T21:00:00.000Z'),
          tags: [],
          notes: null,
          specialRequests: null,
          status: 'cancelled',
        },
      ];
      prisma.reservation.findMany.mockImplementation((args: any) => {
        if (args?.where?.id) return Promise.resolve([]);
        return Promise.resolve(reservations);
      });
      prisma.managerGoal.findMany.mockResolvedValue([
        {
          id: 'goal-open',
          venueId: 'venue-1',
          title: 'Open goal',
          details: null,
          period: 'week',
          targetDate: '2026-07-01',
          status: 'open',
          completedAt: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'goal-future-done',
          venueId: 'venue-1',
          title: 'Future done goal',
          details: null,
          period: 'week',
          targetDate: '2026-07-20',
          status: 'done',
          completedAt: new Date('2026-07-05T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-05T00:00:00.000Z'),
        },
        {
          id: 'goal-past-done',
          venueId: 'venue-1',
          title: 'Past done goal',
          details: null,
          period: 'week',
          targetDate: '2026-07-01',
          status: 'done',
          completedAt: new Date('2026-07-01T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);
      prisma.venueEvent.findMany.mockResolvedValue([]);

      const result = await controller.getManagerDashboard(managerUser);

      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1' } }),
      );
      expect(prisma.managerGoal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1' } }),
      );
      expect(prisma.venueEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1' }) }),
      );

      expect(result.totalReservations).toBe(5);
      expect(result.todayReservations).toBe(1);
      expect(result.vipOrLargeReservations.map((r: any) => r._id)).toEqual(['rsv-large', 'rsv-vip']);
      expect(result.vipOrLargeReservations[1].notes).toBe('Prefers window seat');
      expect(result.goals.map((g: any) => g._id)).toEqual(['goal-open', 'goal-future-done']);
    });

    it('joins venue events with their linked reservation details', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      vi.useFakeTimers();
      vi.setSystemTime(now);
      prisma.reservation.findMany.mockImplementation((args: any) => {
        if (args?.where?.id) {
          return Promise.resolve([
            { id: 'rsv-linked', notes: null, specialRequests: 'Birthday cake', guestName: 'Jamie Guest', partySize: 6 },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.venueEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          venueId: 'venue-1',
          title: 'Birthday Party',
          startsAt: new Date('2026-07-16T20:00:00.000Z'),
          endsAt: null,
          expectedGuests: null,
          notes: null,
          reservationId: 'rsv-linked',
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          updatedAt: new Date('2026-07-10T00:00:00.000Z'),
        },
      ]);

      const result = await controller.getManagerDashboard(managerUser);

      expect(result.events).toEqual([
        expect.objectContaining({
          _id: 'evt-1',
          reservationId: 'rsv-linked',
          reservationGuestName: 'Jamie Guest',
          reservationPartySize: 6,
          reservationNotes: 'Birthday cake',
        }),
      ]);
    });
  });

  describe('getDailyBrief', () => {
    const now = new Date('2026-07-15T18:30:00.000Z');

    it('aggregates counts, scopes queries by venue, and wires helper output into the response', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      vi.useFakeTimers();
      vi.setSystemTime(now);

      prisma.reservation.findMany.mockResolvedValue([
        { id: 'r1', partySize: 3, guestName: 'A', reservationTime: new Date('2026-07-15T19:00:00Z'), tags: [], notes: null, specialRequests: null },
        { id: 'r2', partySize: 2, guestName: 'B', reservationTime: new Date('2026-07-15T20:00:00Z'), tags: [], notes: null, specialRequests: null },
      ]);
      prisma.scheduleShift.findMany.mockResolvedValue([
        { status: 'scheduled' },
        { status: 'scheduled' },
        { status: 'open' },
      ]);
      prisma.timeEntry.findMany.mockImplementation((args: any) => {
        if (args?.where?.isOpen) return Promise.resolve([{ id: 'te-1' }, { id: 'te-2' }, { id: 'te-3' }, { id: 'te-4' }]);
        return Promise.resolve([]);
      });
      prisma.staffRequest.findMany.mockResolvedValue([{ id: 'sr-1' }, { id: 'sr-2' }]);
      prisma.barInventoryItem.findMany.mockResolvedValue([
        { id: 'bi-1', name: 'Vodka', onHand: 1, parLevel: 5, unit: 'bottle' },
        { id: 'bi-2', name: 'Gin', onHand: 2, parLevel: 4, unit: 'bottle' },
        { id: 'bi-3', name: 'Rum', onHand: 10, parLevel: 4, unit: 'bottle' },
      ]);
      prisma.prepBoardItem.findMany.mockResolvedValue([
        { id: 'pb-1', kind: 'eighty_six', title: '86 salmon', quantity: null, unit: null, station: null, dueDate: null },
        { id: 'pb-2', kind: 'eighty_six', title: '86 duck', quantity: null, unit: null, station: null, dueDate: null },
        { id: 'pb-3', kind: 'prep', title: 'Chop onions', quantity: 5, unit: 'lb', station: 'cold', dueDate: null },
      ]);
      prisma.managerGoal.findMany.mockResolvedValue([]);
      prisma.venueEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          title: 'Wine Tasting',
          startsAt: new Date('2026-07-15T22:00:00Z'),
          endsAt: null,
          expectedGuests: 15,
          notes: 'Private room',
          reservationId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      prisma.posCheck.findMany.mockResolvedValue([
        { totalCents: 1000, guestCount: 2 },
        { totalCents: 2000, guestCount: 3 },
      ]);
      prisma.posCheck.count.mockResolvedValue(7);

      const result = await controller.getDailyBrief(managerUser);

      // Tenant isolation on a representative subset of the queries.
      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1' }) }),
      );
      expect(prisma.barInventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1' } }),
      );
      expect(prisma.posCheck.count).toHaveBeenCalledWith({ where: { venueId: 'venue-1', status: 'open' } });

      expect(result.covers).toBe(5);
      expect(result.posCovers).toBe(5);
      expect(result.salesCents).toBe(3000);
      expect(result.scheduledCount).toBe(2);
      expect(result.openShiftCount).toBe(1);
      expect(result.clockedInCount).toBe(4);
      expect(result.pendingRequestCount).toBe(2);
      expect(result.lowStockCount).toBe(2);
      expect(result.eightySixCount).toBe(2);
      expect(result.prepOpenCount).toBe(1);

      expect(buildDailyBriefAlerts).toHaveBeenCalledWith({
        openShiftCount: 1,
        pendingRequestCount: 2,
        lowStockCount: 2,
        eightySixCount: 2,
      });
      expect(buildDailyBriefPriorityActions).toHaveBeenCalledWith(
        expect.objectContaining({
          openShiftCount: 1,
          pendingRequestCount: 2,
          lowStockCount: 2,
          eightySixCount: 2,
          events: [
            expect.objectContaining({
              title: 'Wine Tasting',
              expectedGuests: 15,
              reservationGuestName: null,
              reservationPartySize: null,
              notes: 'Private room',
            }),
          ],
        }),
      );
      expect(buildDailyBriefProfitabilityPulse).toHaveBeenCalledWith({
        salesCents: 3000,
        laborHours: 0,
        openChecks: 7,
        activeClocks: 4,
        openShiftCount: 1,
        pendingRequestCount: 2,
        lowStockCount: 2,
        eightySixCount: 2,
      });

      // The controller wires the (mocked) helper output straight into the response.
      expect(result.alerts).toEqual(['mock-alert']);
      expect(result.priorityActions).toEqual(['mock-priority-action']);
      expect(result.profitabilityPulse).toEqual({ tone: 'good', headline: 'mock-headline', detail: 'mock-detail' });
    });
  });

  describe('upsertManagerGoal', () => {
    it('rejects a blank title', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());

      await expect(
        controller.upsertManagerGoal(managerUser, {
          title: '   ',
          period: 'day',
          targetDate: '2026-07-15',
          status: 'open',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects updating a goal that does not exist (or belongs to another venue)', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.managerGoal.findFirst.mockResolvedValue(null);

      await expect(
        controller.upsertManagerGoal(managerUser, {
          goalId: 'goal-other-venue',
          title: 'Cut waste',
          period: 'week',
          targetDate: '2026-07-15',
          status: 'open',
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.managerGoal.findFirst).toHaveBeenCalledWith({
        where: { id: 'goal-other-venue', venueId: 'venue-1' },
      });
    });

    it('updates an existing goal scoped to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.managerGoal.findFirst.mockResolvedValue({ id: 'goal-1', venueId: 'venue-1' });
      prisma.managerGoal.update.mockResolvedValue({
        id: 'goal-1',
        venueId: 'venue-1',
        title: 'Cut waste',
        details: null,
        period: 'week',
        targetDate: '2026-07-15',
        status: 'done',
        completedAt: new Date('2026-07-15T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-15T00:00:00Z'),
      });

      const result = await controller.upsertManagerGoal(managerUser, {
        goalId: 'goal-1',
        title: 'Cut waste',
        period: 'week',
        targetDate: '2026-07-15',
        status: 'done',
      } as any);

      expect(prisma.managerGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: expect.objectContaining({ venueId: 'venue-1', title: 'Cut waste', status: 'done', completedAt: expect.any(Date) }),
      });
      expect(result._id).toBe('goal-1');
    });

    it('creates a new goal attributed to the creating profile', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.managerGoal.create.mockResolvedValue({
        id: 'goal-new',
        venueId: 'venue-1',
        title: 'Reduce comps',
        details: null,
        period: 'day',
        targetDate: '2026-07-15',
        status: 'open',
        completedAt: null,
        createdAt: new Date('2026-07-15T00:00:00Z'),
        updatedAt: new Date('2026-07-15T00:00:00Z'),
      });

      await controller.upsertManagerGoal(managerUser, {
        title: 'Reduce comps',
        period: 'day',
        targetDate: '2026-07-15',
        status: 'open',
      } as any);

      expect(prisma.managerGoal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ venueId: 'venue-1', createdBy: 'profile-1', status: 'open', completedAt: null }),
      });
    });
  });

  describe('listLogbook', () => {
    it('scopes to the caller venue and clamps the limit into [1, 200]', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());

      await controller.listLogbook(managerUser, '999');
      expect(prisma.logbookEntry.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1' }, take: 200 }),
      );

      await controller.listLogbook(managerUser, '-5');
      expect(prisma.logbookEntry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));

      await controller.listLogbook(managerUser, undefined);
      expect(prisma.logbookEntry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50 }));
    });
  });

  describe('addLogbookEntry', () => {
    it('rejects blank entry text', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());

      await expect(
        controller.addLogbookEntry(managerUser, { category: 'general', body: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('falls back to the "general" category for an unrecognized value', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.logbookEntry.create.mockResolvedValue({
        id: 'entry-1', authorProfileId: 'profile-1', authorName: 'Morgan Manager',
        category: 'general', body: 'Walk-in freezer is loud', pinned: false,
        createdAt: new Date(), updatedAt: new Date(),
      });

      await controller.addLogbookEntry(managerUser, { category: 'not-a-real-category', body: 'Walk-in freezer is loud' });

      expect(prisma.logbookEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: 'general', venueId: 'venue-1', authorProfileId: 'profile-1' }),
      });
    });

    it('silently drops the pin request for a non-admin author', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ role: 'staff' }));
      prisma.logbookEntry.create.mockResolvedValue({
        id: 'entry-1', authorProfileId: 'profile-1', authorName: 'Staffer',
        category: 'handoff', body: 'Handed off to night shift', pinned: false,
        createdAt: new Date(), updatedAt: new Date(),
      });

      await controller.addLogbookEntry(managerUser, { category: 'handoff', body: 'Handed off to night shift', pinned: true });

      expect(prisma.logbookEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ pinned: false }),
      });
    });

    it('honors the pin request for an admin author', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ role: 'manager' }));
      prisma.logbookEntry.create.mockResolvedValue({
        id: 'entry-1', authorProfileId: 'profile-1', authorName: 'Morgan Manager',
        category: 'handoff', body: 'Important note', pinned: true,
        createdAt: new Date(), updatedAt: new Date(),
      });

      await controller.addLogbookEntry(managerUser, { category: 'handoff', body: 'Important note', pinned: true });

      expect(prisma.logbookEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ pinned: true }),
      });
    });
  });

  describe('deleteLogbookEntry', () => {
    it('rejects when the entry is missing or in another venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.logbookEntry.findFirst.mockResolvedValue(null);

      await expect(controller.deleteLogbookEntry(managerUser, 'entry-x')).rejects.toThrow(NotFoundException);
      expect(prisma.logbookEntry.findFirst).toHaveBeenCalledWith({ where: { id: 'entry-x', venueId: 'venue-1' } });
    });

    it('rejects a non-author, non-admin trying to delete someone else\'s entry', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ id: 'profile-2', role: 'staff' }));
      prisma.logbookEntry.findFirst.mockResolvedValue({ id: 'entry-1', authorProfileId: 'profile-1' });

      await expect(controller.deleteLogbookEntry(managerUser, 'entry-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.logbookEntry.delete).not.toHaveBeenCalled();
    });

    it('allows the original author to delete their own entry', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ id: 'profile-1', role: 'staff' }));
      prisma.logbookEntry.findFirst.mockResolvedValue({ id: 'entry-1', authorProfileId: 'profile-1' });

      const result = await controller.deleteLogbookEntry(managerUser, 'entry-1');

      expect(prisma.logbookEntry.delete).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
      expect(result).toEqual({ ok: true });
    });

    it('allows an admin to delete someone else\'s entry', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ id: 'profile-2', role: 'admin' }));
      prisma.logbookEntry.findFirst.mockResolvedValue({ id: 'entry-1', authorProfileId: 'profile-1' });

      await controller.deleteLogbookEntry(managerUser, 'entry-1');

      expect(prisma.logbookEntry.delete).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
    });
  });

  describe('getChecklist', () => {
    it('rejects an invalid kind', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());

      await expect(controller.getChecklist(managerUser, 'lunch')).rejects.toThrow(BadRequestException);
    });

    it('returns an empty list without touching completions when there are no template items', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistTemplateItem.findMany.mockResolvedValue([]);

      const result = await controller.getChecklist(managerUser, 'opening', '2026-07-15');

      expect(result).toEqual({ date: '2026-07-15', kind: 'opening', items: [] });
      expect(prisma.checklistCompletion.createMany).not.toHaveBeenCalled();
    });

    it('backfills missing completions and shapes items, including a signed photo URL', async () => {
      const { controller, prisma, mediaAccess } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistTemplateItem.findMany.mockResolvedValue([
        { id: 'item-1', kind: 'opening', title: 'Turn on lights', sortOrder: 0, requiresPhoto: false },
        { id: 'item-2', kind: 'opening', title: 'Check walk-in temp', sortOrder: 1, requiresPhoto: true },
      ]);
      prisma.checklistCompletion.findMany.mockImplementation((args: any) => {
        if (args.select) return Promise.resolve([{ templateItemId: 'item-1' }]);
        return Promise.resolve([
          { id: 'comp-1', templateItemId: 'item-1', status: 'done', completedByName: 'Alex', completedAt: new Date('2026-07-15T08:00:00Z'), photoKey: null },
          { id: 'comp-2', templateItemId: 'item-2', status: 'done', completedByName: 'Alex', completedAt: new Date('2026-07-15T08:05:00Z'), photoKey: 'photos/comp-2.jpg' },
        ]);
      });

      const result = await controller.getChecklist(managerUser, 'opening', '2026-07-15');

      expect(prisma.checklistCompletion.createMany).toHaveBeenCalledWith({
        data: [{ venueId: 'venue-1', templateItemId: 'item-2', date: '2026-07-15', status: 'pending' }],
        skipDuplicates: true,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual(expect.objectContaining({ _id: 'item-1', hasPhoto: false, photoUrl: null }));
      expect(result.items[1]).toEqual(expect.objectContaining({ _id: 'item-2', hasPhoto: true }));
      expect(mediaAccess.createPath).toHaveBeenCalledWith('checklist-photo', 'comp-2', 'venue-1', '/v1/operations/checklist/photo/comp-2');
    });
  });

  describe('addChecklistItem', () => {
    it('rejects a blank title', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());

      await expect(
        controller.addChecklistItem(managerUser, { kind: 'opening', title: '  ' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('appends the new item to the end of the active list, scoped to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistTemplateItem.count.mockResolvedValue(3);
      prisma.checklistTemplateItem.create.mockResolvedValue({ id: 'item-4', kind: 'closing', title: 'Lock the safe', sortOrder: 3, requiresPhoto: true });

      const result = await controller.addChecklistItem(managerUser, { kind: 'closing', title: 'Lock the safe', requiresPhoto: true } as any);

      expect(prisma.checklistTemplateItem.count).toHaveBeenCalledWith({
        where: { venueId: 'venue-1', kind: 'closing', active: true },
      });
      expect(prisma.checklistTemplateItem.create).toHaveBeenCalledWith({
        data: { venueId: 'venue-1', kind: 'closing', title: 'Lock the safe', requiresPhoto: true, sortOrder: 3 },
      });
      expect(result._id).toBe('item-4');
    });
  });

  describe('removeChecklistItem', () => {
    it('rejects when the item is missing or in another venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistTemplateItem.findFirst.mockResolvedValue(null);

      await expect(controller.removeChecklistItem(managerUser, 'item-x')).rejects.toThrow(NotFoundException);
    });

    it('soft-deactivates rather than deleting the row', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistTemplateItem.findFirst.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });

      const result = await controller.removeChecklistItem(managerUser, 'item-1');

      expect(prisma.checklistTemplateItem.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { active: false } });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('completeChecklistItem', () => {
    it('rejects when the completion is missing or in another venue', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue(null);

      await expect(controller.completeChecklistItem(managerUser, 'comp-x', {})).rejects.toThrow(NotFoundException);
    });

    it('rejects completing a task that is already done', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue({
        id: 'comp-1', status: 'done', templateItem: { requiresPhoto: false },
      });

      await expect(controller.completeChecklistItem(managerUser, 'comp-1', {})).rejects.toThrow(BadRequestException);
    });

    it('rejects a photo-required task submitted without a photo', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue({
        id: 'comp-1', status: 'pending', templateItem: { requiresPhoto: true },
      });

      await expect(controller.completeChecklistItem(managerUser, 'comp-1', {})).rejects.toThrow(
        'This task requires a photo before it can be marked done',
      );
    });

    it('treats an empty photoBase64 string as "no photo" rather than an error', async () => {
      const { controller, prisma, s3ImageService } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue({
        id: 'comp-1', status: 'pending', templateItem: { requiresPhoto: false },
      });
      prisma.checklistCompletion.update.mockResolvedValue({
        id: 'comp-1', status: 'done', completedByName: 'Morgan Manager', completedAt: new Date(), photoKey: null,
      });

      await expect(
        controller.completeChecklistItem(managerUser, 'comp-1', { photoBase64: '' }),
      ).resolves.toBeDefined();
      expect(s3ImageService.upload).not.toHaveBeenCalled();
    });

    it('rejects a photo over the 5MB limit', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue({
        id: 'comp-1', status: 'pending', templateItem: { requiresPhoto: false },
      });
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString('base64');

      await expect(
        controller.completeChecklistItem(managerUser, 'comp-1', { photoBase64: oversized }),
      ).rejects.toThrow('Photo is too large (max 5MB)');
    });

    it('marks the task done without a photo', async () => {
      const { controller, prisma, s3ImageService } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue({
        id: 'comp-1', status: 'pending', templateItem: { requiresPhoto: false },
      });
      prisma.checklistCompletion.update.mockResolvedValue({
        id: 'comp-1', status: 'done', completedByName: 'Morgan Manager', completedAt: new Date('2026-07-15T09:00:00Z'), photoKey: null,
      });

      const result = await controller.completeChecklistItem(managerUser, 'comp-1', {});

      expect(s3ImageService.upload).not.toHaveBeenCalled();
      expect(prisma.checklistCompletion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: expect.objectContaining({ status: 'done', completedBy: 'profile-1', completedByName: 'Morgan Manager' }),
      });
      expect(result.hasPhoto).toBe(false);
    });

    it('uploads and attaches a valid photo', async () => {
      const { controller, prisma, s3ImageService } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile());
      prisma.checklistCompletion.findFirst.mockResolvedValue({
        id: 'comp-1', status: 'pending', templateItem: { requiresPhoto: true },
      });
      prisma.checklistCompletion.update.mockResolvedValue({
        id: 'comp-1', status: 'done', completedByName: 'Morgan Manager', completedAt: new Date('2026-07-15T09:00:00Z'), photoKey: 's3-key-1',
      });
      // Minimal valid JPEG magic bytes so assertAllowedImageBytes accepts it.
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);

      const result = await controller.completeChecklistItem(managerUser, 'comp-1', {
        photoBase64: jpegBytes.toString('base64'),
        photoMimeType: 'image/jpeg',
      });

      expect(s3ImageService.upload).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', 'venue-1');
      expect(prisma.checklistCompletion.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: expect.objectContaining({ photoKey: 's3-key-1' }),
      });
      expect(result.hasPhoto).toBe(true);
    });
  });

  describe('getChecklistPhoto', () => {
    it('rejects when the completion does not exist', async () => {
      const { controller, prisma } = makeController();
      prisma.checklistCompletion.findUnique.mockResolvedValue(null);
      const res = { setHeader: vi.fn(), redirect: vi.fn() } as any;

      await expect(controller.getChecklistPhoto('comp-x', 'tok', res)).rejects.toThrow(NotFoundException);
    });

    it('rejects when the completion has no photo', async () => {
      const { controller, prisma } = makeController();
      prisma.checklistCompletion.findUnique.mockResolvedValue({ id: 'comp-1', photoKey: null, venueId: 'venue-1' });
      const res = { setHeader: vi.fn(), redirect: vi.fn() } as any;

      await expect(controller.getChecklistPhoto('comp-1', 'tok', res)).rejects.toThrow(NotFoundException);
    });

    it('validates the media token before redirecting to a presigned URL', async () => {
      const { controller, prisma, mediaAccess, s3ImageService } = makeController();
      prisma.checklistCompletion.findUnique.mockResolvedValue({ id: 'comp-1', photoKey: 'photos/comp-1.jpg', venueId: 'venue-1' });
      const res = { setHeader: vi.fn(), redirect: vi.fn() } as any;

      await controller.getChecklistPhoto('comp-1', 'tok', res);

      expect(mediaAccess.assertToken).toHaveBeenCalledWith('tok', 'checklist-photo', 'comp-1', 'venue-1');
      expect(s3ImageService.getPresignedUrl).toHaveBeenCalledWith('photos/comp-1.jpg');
      expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
      expect(res.redirect).toHaveBeenCalledWith(302, 'https://signed.example/img.jpg');
    });

    it('propagates a rejected/invalid token instead of redirecting', async () => {
      const { controller, prisma, mediaAccess } = makeController();
      prisma.checklistCompletion.findUnique.mockResolvedValue({ id: 'comp-1', photoKey: 'photos/comp-1.jpg', venueId: 'venue-1' });
      mediaAccess.assertToken.mockRejectedValue(new Error('Media access token is invalid or expired'));
      const res = { setHeader: vi.fn(), redirect: vi.fn() } as any;

      await expect(controller.getChecklistPhoto('comp-1', 'bad-tok', res)).rejects.toThrow('Media access token is invalid or expired');
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
