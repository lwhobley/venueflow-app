import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FloorController } from './floor.controller';

function makeController() {
  const floor = {
    getActiveFloorPlan: vi.fn().mockResolvedValue({ floorPlan: { id: 'plan-1' } }),
    getFloorStats: vi.fn().mockResolvedValue({ totalTables: 4 }),
    saveFloorPlan: vi.fn().mockResolvedValue({ ok: true }),
    clearActiveFloorPlan: vi.fn().mockResolvedValue({ deletedTables: 2, deletedChairs: 1 }),
    getUnassignedReservations: vi.fn().mockResolvedValue([{ id: 'res-1' }]),
    getOpenWaitlist: vi.fn().mockResolvedValue([{ id: 'wl-1' }]),
    addToWaitlist: vi.fn().mockResolvedValue({ _id: 'wl-1', id: 'wl-1' }),
    removeFromWaitlist: vi.fn().mockResolvedValue({ ok: true }),
    markWaitlistReady: vi.fn().mockResolvedValue({ ok: true }),
    updateTableStatus: vi.fn().mockResolvedValue({ ok: true }),
    mergeTablesForParty: vi.fn().mockResolvedValue({ ok: true, mergeGroupId: 'merge-1' }),
    splitMergedTables: vi.fn().mockResolvedValue({ ok: true, splitTables: 2 }),
    assignReservationToTables: vi.fn().mockResolvedValue({ ok: true }),
    assignWaitlistToTables: vi.fn().mockResolvedValue({ ok: true }),
    releaseAssignment: vi.fn().mockResolvedValue({ ok: true }),
    emptyStats: vi.fn().mockReturnValue({ totalTables: 0 }),
  } as any;
  const controller = new FloorController(floor);
  return { controller, floor };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FloorController', () => {
  describe('authorization (manager-only endpoints)', () => {
    it('rejects staff from saving a floor plan', async () => {
      const { controller } = makeController();
      await expect(controller.saveFloorPlan(staffScope, { tables: [] } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects a missing scope from saving a floor plan', async () => {
      const { controller } = makeController();
      await expect(controller.saveFloorPlan(undefined as any, { tables: [] } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from clearing the active floor plan', async () => {
      const { controller } = makeController();
      await expect(controller.clearActiveFloorPlan(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from merging tables', async () => {
      const { controller } = makeController();
      await expect(controller.mergeTablesForParty(staffScope, { tableIds: ['t1', 't2'] } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from splitting merged tables', async () => {
      const { controller } = makeController();
      await expect(controller.splitMergedTables(staffScope, 'merge-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from assigning a reservation to tables', async () => {
      const { controller } = makeController();
      await expect(
        controller.assignReservationToTables(staffScope, { reservationId: 'res-1', tableIds: ['t1'] } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from assigning waitlist entries to tables', async () => {
      const { controller } = makeController();
      await expect(
        controller.assignWaitlistToTables(staffScope, { waitlistId: 'wl-1', tableIds: ['t1'] } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from releasing an assignment', async () => {
      const { controller } = makeController();
      await expect(controller.releaseAssignment(staffScope, 'assign-1')).rejects.toThrow(ForbiddenException);
    });

    it('allows a manager to save a floor plan', async () => {
      const { controller, floor } = makeController();
      const body = { name: 'Main Room', tables: [] } as any;

      const result = await controller.saveFloorPlan(managerScope, body);

      expect(floor.saveFloorPlan).toHaveBeenCalledWith('venue-1', body);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('getActiveFloorPlan / getFloorStats (scope-optional endpoints)', () => {
    it('returns null when there is no scope', async () => {
      const { controller, floor } = makeController();
      await expect(controller.getActiveFloorPlan(undefined as any)).resolves.toBeNull();
      expect(floor.getActiveFloorPlan).not.toHaveBeenCalled();
    });

    it('delegates to the service scoped by venueId when a scope is present', async () => {
      const { controller, floor } = makeController();
      const result = await controller.getActiveFloorPlan(staffScope);
      expect(floor.getActiveFloorPlan).toHaveBeenCalledWith('venue-1');
      expect(result).toEqual({ floorPlan: { id: 'plan-1' } });
    });

    it('returns empty stats when there is no scope', async () => {
      const { controller, floor } = makeController();
      const result = await controller.getFloorStats(undefined as any);
      expect(result).toEqual({ totalTables: 0 });
      expect(floor.getFloorStats).not.toHaveBeenCalled();
    });

    it('delegates stats to the service scoped by venueId', async () => {
      const { controller, floor } = makeController();
      const result = await controller.getFloorStats(staffScope);
      expect(floor.getFloorStats).toHaveBeenCalledWith('venue-1');
      expect(result).toEqual({ totalTables: 4 });
    });
  });

  describe('getUnassignedReservations / getOpenWaitlist', () => {
    it('returns an empty list when there is no scope', async () => {
      const { controller, floor } = makeController();
      await expect(controller.getUnassignedReservations(undefined as any, '30')).resolves.toEqual([]);
      expect(floor.getUnassignedReservations).not.toHaveBeenCalled();
    });

    it('passes the venueId and withinMinutes through to the service', async () => {
      const { controller, floor } = makeController();
      const result = await controller.getUnassignedReservations(staffScope, '45');
      expect(floor.getUnassignedReservations).toHaveBeenCalledWith('venue-1', '45');
      expect(result).toEqual([{ id: 'res-1' }]);
    });

    it('returns an empty waitlist when there is no scope', async () => {
      const { controller, floor } = makeController();
      await expect(controller.getOpenWaitlist(undefined as any)).resolves.toEqual([]);
      expect(floor.getOpenWaitlist).not.toHaveBeenCalled();
    });
  });

  describe('waitlist mutations', () => {
    it('rejects adding to the waitlist without a venue profile', async () => {
      const { controller } = makeController();
      await expect(controller.addToWaitlist(undefined as any, { guestName: 'Alex', partySize: 2 } as any)).rejects.toThrow(
        'No venue profile found',
      );
    });

    it('adds a walk-in to the waitlist scoped by venueId', async () => {
      const { controller, floor } = makeController();
      const body = { guestName: 'Alex', partySize: 2 } as any;
      const result = await controller.addToWaitlist(staffScope, body);
      expect(floor.addToWaitlist).toHaveBeenCalledWith('venue-1', body);
      expect(result).toEqual({ _id: 'wl-1', id: 'wl-1' });
    });

    it('rejects removing from the waitlist without a venue profile', async () => {
      const { controller } = makeController();
      await expect(controller.removeFromWaitlist(undefined as any, 'wl-1')).rejects.toThrow('No venue profile found');
    });

    it('rejects marking waitlist ready without a venue profile', async () => {
      const { controller } = makeController();
      await expect(controller.markWaitlistReady(undefined as any, 'wl-1')).rejects.toThrow('No venue profile found');
    });

    it('marks a waitlist entry ready scoped by venueId', async () => {
      const { controller, floor } = makeController();
      await controller.markWaitlistReady(staffScope, 'wl-1');
      expect(floor.markWaitlistReady).toHaveBeenCalledWith('venue-1', 'wl-1');
    });
  });

  describe('updateTableStatus', () => {
    it('rejects without a venue profile', async () => {
      const { controller } = makeController();
      await expect(controller.updateTableStatus(undefined as any, 'table-1', { status: 'dirty' })).rejects.toThrow(
        'No venue profile found',
      );
    });

    it('updates the table status scoped by venueId', async () => {
      const { controller, floor } = makeController();
      await controller.updateTableStatus(staffScope, 'table-1', { status: 'dirty' });
      expect(floor.updateTableStatus).toHaveBeenCalledWith('venue-1', 'table-1', 'dirty');
    });
  });

  describe('manager-only mutations delegate with correct arguments', () => {
    it('merges tables for a party', async () => {
      const { controller, floor } = makeController();
      const result = await controller.mergeTablesForParty(managerScope, { tableIds: ['t1', 't2'], partySize: 4 } as any);
      expect(floor.mergeTablesForParty).toHaveBeenCalledWith('venue-1', ['t1', 't2'], 4);
      expect(result).toEqual({ ok: true, mergeGroupId: 'merge-1' });
    });

    it('splits a merged table group', async () => {
      const { controller, floor } = makeController();
      await controller.splitMergedTables(managerScope, 'merge-1');
      expect(floor.splitMergedTables).toHaveBeenCalledWith('venue-1', 'merge-1');
    });

    it('assigns a reservation to tables', async () => {
      const { controller, floor } = makeController();
      await controller.assignReservationToTables(managerScope, { reservationId: 'res-1', tableIds: ['t1'] } as any);
      expect(floor.assignReservationToTables).toHaveBeenCalledWith('venue-1', 'res-1', ['t1']);
    });

    it('assigns a waitlist entry to tables', async () => {
      const { controller, floor } = makeController();
      const body = { waitlistId: 'wl-1', tableIds: ['t1'], holdType: 'seated' } as any;
      await controller.assignWaitlistToTables(managerScope, body);
      expect(floor.assignWaitlistToTables).toHaveBeenCalledWith('venue-1', body);
    });

    it('releases an assignment', async () => {
      const { controller, floor } = makeController();
      await controller.releaseAssignment(managerScope, 'assign-1');
      expect(floor.releaseAssignment).toHaveBeenCalledWith('venue-1', 'assign-1');
    });
  });
});
